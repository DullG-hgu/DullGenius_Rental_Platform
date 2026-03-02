// src/api.js
import { supabase } from './lib/supabaseClient';
import { statusToKorean, koreanToStatus } from './constants'; // [NEW] STATUS enum 헬퍼 함수
import { calculateGameStatus } from './lib/gameStatus';

/**
 * 전체 게임 목록을 가져옵니다.
 * 이 함수는 Application-Side Join을 사용하여 게임 정보, 대여 기록, 프로필 정보를 병합합니다.
 * 
 * @returns {Promise<Array>} 병합된 게임 정보 배열
 * @throws {Error} Supabase 조회 중 발생한 에러
 */
export const fetchGames = async () => {

  try {
    // [Step 1] 병렬 데이터 조회
    // game_copies 테이블은 삭제되었으므로 games와 rentals만 조회
    const [gamesRes, rentalsRes] = await Promise.all([
      supabase.from('games').select('*').order('name'),
      supabase.from('rentals').select('rental_id, game_id, user_id, renter_name, type, returned_at, due_date, borrowed_at').is('returned_at', null)
    ]);

    if (gamesRes.error) throw gamesRes.error;
    if (rentalsRes.error) console.warn("Rentals fetch failed:", rentalsRes.error);

    const games = gamesRes.data || [];
    const activeRentals = rentalsRes.data || [];



    // [Step 2] 렌탈 유저 정보(Profile) 조회
    const userIds = [...new Set(activeRentals.map(r => r.user_id).filter(Boolean))];
    let profilesMap = {};

    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', userIds);

      if (!profilesError && profiles) {
        profiles.forEach(p => profilesMap[p.id] = p.name);
      }
    }

    // [Step 3] 데이터 병합 (Application-Side Join)
    // Rental 그룹화 (game_id 기준)
    const rentalsByGame = {};
    activeRentals.forEach(r => {
      if (!rentalsByGame[r.game_id]) rentalsByGame[r.game_id] = [];
      // 프로필 정보 주입
      if (r.user_id && profilesMap[r.user_id]) {
        r.profiles = { name: profilesMap[r.user_id] };
      }
      rentalsByGame[r.game_id].push(r);
    });

    // [Step 4] 최종 게임 객체 생성
    return games.map(game => {
      const gameRentals = rentalsByGame[game.id] || [];

      // [REF] 로직 캡슐화 (src/lib/gameStatus.js)
      // 상태 결정 로직을 완전히 분리하여 안전하게 관리함
      const statusData = calculateGameStatus(game, gameRentals);

      return {
        ...game,
        ...statusData
      };
    });

  } catch (e) {
    console.error("fetchGames 실패:", e);
    throw e;
  }
};

/**
 * 특정 게임 1개의 최신 상태를 서버에서 정확하게 재조회합니다.
 * 찜/취소 후 로컬 추정 대신 서버의 실제 대여 기록 기반으로 정확한 available_count를 반환합니다.
 *
 * @param {number} gameId - 게임 ID
 * @returns {Promise<Object|null>} 최신 게임 객체 또는 null
 */
export const fetchGameById = async (gameId) => {
  try {
    const [gameRes, rentalsRes] = await Promise.all([
      supabase.from('games').select('*').eq('id', gameId).single(),
      supabase.from('rentals')
        .select('rental_id, game_id, user_id, renter_name, type, returned_at, due_date, borrowed_at')
        .eq('game_id', gameId)
        .is('returned_at', null)
    ]);

    if (gameRes.error) throw gameRes.error;

    const game = gameRes.data;
    const gameRentals = rentalsRes.data || [];

    const statusData = calculateGameStatus(game, gameRentals);
    return { ...game, ...statusData };
  } catch (e) {
    console.error("fetchGameById 실패:", e);
    return null;
  }
};



/**
 * 게임을 즉시 대여 처리합니다. (회원 전용)
 * 
 * @param {number} gameId - 게임 ID
 * @param {string} userId - 사용자 UUID
 * @returns {Promise<Object>} RPC 결과 객체
 * @throws {Error} RPC 실행 중 발생한 에러
 */
export const rentGame = async (gameId, userId) => {
  const { data, error } = await supabase.rpc('rent_game', {
    p_game_id: gameId,
    p_user_id: userId,
    p_renter_name: '회원'
  });
  if (error) throw error;
  return data;
};

/**
 * 게임을 찜(예약) 처리합니다.
 * 
 * @param {number} gameId - 게임 ID
 * @param {string} userId - 사용자 UUID
 * @returns {Promise<Object>} RPC 결과 객체
 * @throws {Error} RPC 실행 중 발생한 에러
 */
export const dibsGame = async (gameId, userId) => {
  const { data, error } = await supabase.rpc('dibs_game', {
    p_game_id: gameId,
    p_user_id: userId
  });
  if (error) throw error;
  return data;
};

/**
 * 찜(예약)을 취소합니다.
 * 
 * @param {number} gameId - 게임 ID
 * @param {string} userId - 사용자 UUID
 * @returns {Promise<Object>} RPC 결과 객체
 * @throws {Error} RPC 실행 중 발생한 에러
 */
export const cancelDibsGame = async (gameId, userId) => {
  const { data, error } = await supabase.rpc('cancel_dibs', {
    p_game_id: gameId,
    p_user_id: userId
  });
  if (error) throw error;
  return data;
};

/**
 * 특정 게임의 리뷰 목록을 가져오며, 중복된 리뷰를 필터링합니다.
 * 
 * @param {number} [gameId] - 필터링할 게임 ID (없으면 전체 조회)
 * @returns {Promise<Array>} 중복 제거된 리뷰 배열
 */
export const fetchReviews = async (gameId) => {
  // author_name이 reviews 테이블에 있으므로 그냥 가져오면 됨
  let query = supabase
    .from('reviews')
    .select('*')
    .order('created_at', { ascending: false });

  if (gameId) {
    query = query.eq('game_id', gameId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("리뷰 로딩 실패:", error);
    return [];
  }

  // [FIX] 서버 DB에 중복된 데이터가 있을 경우를 대비해, API 레벨에서 중복 제거
  // (작성자 + 내용 + 게임ID)가 같으면 중복으로 간주하고 최신 것만 남김
  const uniqueReviews = [];
  const seen = new Set();

  for (const review of data) {
    // 키 생성 (유니크 조건)
    const key = `${review.game_id} -${review.author_name || review.user_name} -${review.content} `;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueReviews.push(review);
    }
  }

  return uniqueReviews;
};

/**
 * 새로운 리뷰를 작성합니다. (로그인 필수)
 * 
 * @param {Object} reviewData - 리뷰 데이터 { game_id, rating, comment, user_name }
 * @returns {Promise<Object>} 작성된 리뷰 데이터
 * @throws {Error} 로그인되지 않았거나 작성 실패 시
 */
export const addReview = async (reviewData) => {
  // reviewData: { game_id, rating, comment, user_name }
  // user_id는 Auth Policy가 처리하거나, 명시적으로 보내야 함. RLS에서 auth.uid()=user_id 체크하므로,
  // insert할 때 현재 세션 유저와 user_id가 일치해야 함.
  // 하지만 가장 확실한 건 supabase client가 세션을 물고 있으므로, user_id를 같이 보내주면 됨.

  // AuthContext 등에서 user.id를 받아왔다고 가정하고 호출해야 함.
  // 하지만 현재 api 호출부(GameDetail)는 user_id를 안 넘기고 있음.
  // GameDetail.js 수정 없이 해결하려면:
  // supabase.auth.getUser()로 여기서 확인? -> 가능하지만 느림.

  // GameDetail.js 구조 상 user object가 있음. 
  // 여기서는 Supabase Client가 있으므로, 굳이 인자로 안 받아도 내부적으로 auth.getUser() 가능.
  // 하지만 payload에 user_id가 없으면 RLS 에러 날 수 있으니 넣어주는 게 좋음.

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다.");

  const { data, error } = await supabase
    .from('reviews')
    .insert([{
      game_id: reviewData.game_id,
      user_id: user.id,
      author_name: reviewData.user_name, // 닉네임
      rating: parseInt(reviewData.rating),
      content: reviewData.comment
    }])
    .select();

  if (error) throw error;
  return data;
};

/**
 * 리뷰를 삭제합니다. (RLS에 의해 본인 또는 관리자만 가능)
 * 
 * @param {string} reviewId - 리뷰 ID (UUID)
 * @returns {Promise<Object>} 성공 여부 객체 { status: "success" | "error" }
 */
export const deleteReview = async (reviewId) => {
  // password 검증 로직 제거 (Supabase Auth가 본인 확인)
  // 본인 글이면 삭제 가능 (RLS)

  const { error } = await supabase
    .from('reviews')
    .delete()
    .eq('review_id', reviewId);

  if (error) return { status: "error", message: error.message };
  return { status: "success" };
};

/**
 * 리뷰를 수정합니다. (RLS에 의해 본인만 가능)
 *
 * @param {string} reviewId - 리뷰 ID (UUID)
 * @param {{ rating: number, content: string }} updatedData - 수정할 데이터
 * @returns {Promise<Object>} 성공 여부 객체 { status: "success" | "error" }
 */
export const updateReview = async (reviewId, updatedData) => {
  const { error } = await supabase
    .from('reviews')
    .update({
      rating: parseInt(updatedData.rating),
      content: updatedData.content,
    })
    .eq('review_id', reviewId);

  if (error) return { status: "error", message: error.message };
  return { status: "success" };
};

/**
 * 게임의 조회수를 1 증가시킵니다.
 * 
 * @param {number} gameId - 게임 ID
 */
export const increaseViewCount = async (gameId) => {
  await supabase.rpc('increment_view_count', { p_game_id: gameId });
};

/**
 * 급상승 게임(최근 7일 집계) 목록을 가져옵니다.
 * RPC가 실패할 경우 전체 조회수 기준의 Fallback을 제공합니다.
 * 
 * @returns {Promise<Array>} 트렌딩 게임 배열
 */
export const fetchTrending = async () => {
  try {
    // [FIX] 최근 7일 집계 로직이 반영된 RPC 호출
    const { data: trendingData, error } = await supabase
      .rpc('get_trending_games');

    if (error || !trendingData || trendingData.length === 0) {
      // RPC가 아직 없거나 에러인 경우 fallback: 기존 방식(총 조회수)
      if (error) console.warn("Trending RPC Error (Fallback to total_views):", error.message);
      const { data, error: fbError } = await supabase
        .from('games')
        .select('*')
        .order('total_views', { ascending: false })
        .limit(20);

      if (fbError) throw fbError;
      return data;
    }

    // RPC 리턴값: { id, name, image, category, weekly_views }
    // 프론트엔드 컴포넌트는 game object 전체를 기대할 수 있으므로,
    // 필요하다면 여기서 매핑하거나, RPC에서 더 많은 필드를 반환해야 함.
    // 현재는 id, name, image, category만으로도 충분할 수 있음 (DashboardTab UI 체크 필요).
    return trendingData;

  } catch (error) {
    console.error("Trending Fetch Failed:", error);
    return [];
  }
};

// [IMPROVED] 설정값 가져오기 (DB: app_config)
export const fetchConfig = async () => {
  const DEFAULT_KEY = 'recommendations';

  // 1. Supabase에서 설정 가져오기
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', DEFAULT_KEY)
    .single();

  if (error || !data) {
    // 2. 없으면 기본값 반환 (DB에 없을 때)
    console.warn("설정 로드 실패 또는 없음, 기본값 사용:", error?.message);
    return [
      { label: "#입문\\n추천", value: "#입문", color: "#f1c40f", key: "default_1" },
      { label: "#파티\\n게임", value: "#파티", color: "#e67e22", key: "default_2" },
      { label: "#전략\\n게임", value: "#전략", color: "#e74c3c", "key": "default_3" },
      { label: "#2인\\n추천", value: "#2인", color: "#9b59b6", key: "default_4" }
    ];
  }

  // 3. DB에 있으면 그 값 반환
  // JSONB 컬럼이므로 자동으로 파싱된 객체/배열이 반환됨
  return data.value;
};

// 오피스아워 상태 조회
export const fetchOfficeStatus = async () => {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'office_status')
    .single();
  return data?.value ?? { open: false, auto_close_at: null };
};

// 오피스아워 배너 설정 조회
export const fetchOfficeHoursConfig = async () => {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'office_hours_config')
    .single();
  return data?.value ?? {
    auto_close_hour: 21,
    auto_close_minute: 0,
    banner_icon: '🟢',
    banner_title: '오피스아워 진행 중!',
    banner_subtitle: '지금 방문하시면 게임을 대여할 수 있어요',
    banner_color: 'linear-gradient(135deg, #1a5c2a, #27ae60)',
    schedule_icon: '📅',
    schedule_text: '',
    offline_text: '현재 오피스아워를 운영하고 있지 않아요'
  };
};

// 회비 검사 활성화 여부 조회
export const fetchPaymentCheckEnabled = async () => {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'payment_check_enabled')
    .single();
  return data?.value === 'true';
};

// 오피스아워 배너 설정 저장
export const saveOfficeHoursConfig = async (config) => {
  const { error } = await supabase
    .from('app_config')
    .upsert({ key: 'office_hours_config', value: config }, { onConflict: 'key' });
  if (error) throw error;
};

// 5. 아쉬워요 (수요조사)
export const sendMiss = async (gameId) => {
  // [FIX] details를 문자열이 아닌 JSON 구조로 변경하여 JSONB 호환성 확보
  await sendLog(gameId, 'MISS', { message: '입고 요청' });
  return { result: "success" };
};

// [Admin] Legacy placeholders
export const loginUser = async () => { throw new Error("useAuth().login을 사용하세요."); };
export const signupUser = async () => { throw new Error("useAuth().signup을 사용하세요."); };

// [Admin] 검색용 네이버 API (Proxy 사용)
export const searchNaver = async (query) => {
  if (!query) return { items: [] };

  try {
    let url;
    // [FIX] 환경에 따른 URL 분기
    // 개발 환경(npm start): setupProxy.js가 가로채는 '/v1' 경로 사용
    // 배포 환경(Netlify): Serverless Function 경로 사용
    if (import.meta.env.DEV) {
      url = `/v1/search/shop.json?query=${encodeURIComponent(query)}&display=10`;
    } else {
      url = `/.netlify/functions/naver-proxy?query=${encodeURIComponent(query)}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      const errText = await response.text();
      console.error("Naver API Error:", errText);
      throw new Error(`API 호출 실패(${response.status})`);
    }

    const data = await response.json();

    return data;
  } catch (e) {
    console.error("검색 중 오류:", e);
    throw e;
  }
};

// [Admin] 게임 추가 (개선됨)
export const addGame = async (gameData) => {
  // 1. Games 테이블 추가
  const { data: newGame, error } = await supabase
    .from('games')
    .insert([{
      name: gameData.name,
      category: gameData.category || '보드게임',
      players: gameData.players,
      difficulty: gameData.difficulty === "" ? null : gameData.difficulty, // [FIX] 빈 문자열은 DB에서 numeric 변환 불가
      image: gameData.image,
      video_url: gameData.video_url,
      recommendation_text: gameData.recommendation_text,
      manual_url: gameData.manual_url,
      tags: gameData.tags,
      total_views: 0,
      quantity: 1, // [NEW] 기본 재고 1
      available_count: 1 // [NEW] 대여 가능 1
    }])
    .select()
    .single();

  if (error) throw error;

  // 2. Game Copy 추가 (제거됨 - games 테이블에 통합)

  return newGame;
};

// [Admin] 게임 이름 중복 확인 [NEW]
export const checkGameExists = async (name) => {
  const { data, error } = await supabase
    .from('games')
    .select('id, name, quantity')
    .eq('name', name);

  if (error) return [];
  return data; // 중복된 게임 리스트 (보통 1개여야 함)
};

// [Admin] 기존 게임에 재고(Copy) 추가 [NEW]
export const addGameCopy = async (gameId) => { // location removed (no column)
  // 1. 현재 수량 가져오기
  const { data: game, error: fetchError } = await supabase
    .from('games')
    .select('quantity, available_count')
    .eq('id', gameId)
    .single();

  if (fetchError) throw fetchError;

  // 2. 수량 증가
  const newQty = (game.quantity || 0) + 1;
  const newAvail = (game.available_count || 0) + 1;

  // 3. 업데이트
  const { data, error } = await supabase
    .from('games')
    .update({ quantity: newQty, available_count: newAvail })
    .eq('id', gameId)
    .select();

  if (error) throw error;
  return data;
};

// [Admin] 설정 저장 (DB: app_config)
export const saveConfig = async (newConfig) => {
  const DEFAULT_KEY = 'recommendations';

  // Supabase에 Upsert (Insert or Update)
  const { error } = await supabase
    .from('app_config')
    .upsert({
      key: DEFAULT_KEY,
      value: newConfig,
      updated_at: new Date()
    }, { onConflict: 'key' });

  if (error) {
    console.error("설정 저장 실패:", error);
    throw error;
  }

  return { status: "success" };
};

/**
 * 전체 사용자 목록을 가져오며, 각 사용자의 역할(관리자, 집행부 등) 정보를 병합합니다.
 * 
 * @returns {Promise<Array>} 역할 정보가 포함된 프로필 배열
 */
export const fetchUsers = async () => {
  // 1. 프로필 조회
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, student_id, phone, is_paid, joined_semester, status')
    .order('name');

  if (profileError) {
    console.error('Error fetching profiles:', profileError);
    return [];
  }

  // 2. 역할 조회 (전체 가져오기) - 실패해도 프로필은 반환
  let roles = [];
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('user_id, role_key');
    if (error) throw error;
    roles = data;
  } catch (e) {
    console.warn('Error fetching roles (might be RLS):', e);
    // 역할 조회 실패 시 빈 배열로 진행
  }

  // 3. 데이터 병합
  const roleMap = {};
  if (roles) {
    roles.forEach(r => {
      if (!roleMap[r.user_id]) roleMap[r.user_id] = [];
      roleMap[r.user_id].push(r.role_key);
    });
  }

  return profiles.map(profile => ({
    ...profile,
    roles: roleMap[profile.id] || []
  }));
};

/**
 * 게임의 기본 정보(이름, 카테고리, 태그 등)를 수정합니다.
 * 
 * @param {Object} gameData - 수정할 게임 데이터 (game_id 필수)
 * @throws {Error} DB 업데이트 실패 시
 */
export const editGame = async (gameData) => {
  const { error } = await supabase
    .from('games')
    .update({
      name: gameData.name,
      category: gameData.category,
      players: gameData.players,
      difficulty: gameData.difficulty === "" ? null : gameData.difficulty, // [FIX] 빈 문자열은 numeric 타입 에러 방지
      tags: gameData.tags,
      image: gameData.image,
      video_url: gameData.video_url,
      recommendation_text: gameData.recommendation_text,
      manual_url: gameData.manual_url
    })
    .eq('id', gameData.game_id);
  if (error) throw error;
};

/**
 * 관리자용 게임 상태 변경 함수입니다. (RPC 연동)
 * '대여중'(RENTED) 또는 '대여가능'(AVAILABLE) 상태로 강제 전환합니다.
 * 
 * @param {number} gameId - 게임 ID
 * @param {string} newStatus - 변경할 한국어 상태명
 * @param {string} [renterName] - 대여자 이름 (수기 입력/비회원용)
 * @param {string} [userId] - 대여자 UUID (회원용)
 * @param {string} [rentalId] - 특정 대여 기록 UUID (정밀 타겟팅용)
 * @returns {Promise<Object>} 성공 여부 객체
 * @throws {Error} RPC 오류 또는 처리 실패 시
 */
export const adminUpdateGame = async (gameId, newStatus, renterName, userId, rentalId) => {
  const statusKey = koreanToStatus(newStatus) || 'AVAILABLE';

  try {
    if (statusKey === 'RENTED') {
      // 관리자 대여
      const { data, error } = await supabase.rpc('admin_rent_game', {
        p_game_id: gameId,
        p_renter_name: renterName || (userId ? "회원" : "관리자"),
        p_user_id: userId || null,
        p_rental_id: rentalId
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.message);
      return { status: "success" };

    } else if (statusKey === 'AVAILABLE') {
      // 관리자 반납
      const { data, error } = await supabase.rpc('admin_return_game', {
        p_game_id: gameId,
        p_renter_name: renterName,
        p_user_id: userId,
        p_rental_id: rentalId
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      // [FIX] 반납 처리 시 명시적으로 로그 추가 (DB RPC 미작동 대비)
      await sendLog(gameId, 'RETURN', '관리자 반납 처리');

      return { status: "success" };
    } else {
      // 그 외 상태(분실, 수리중 등)는 available_count 조정
      // 예: 분실 시 quantity 감소
      await sendLog(gameId, 'STATUS_CHANGE', { status: newStatus });
      return { status: "success" };
    }
  } catch (e) {
    console.error("adminUpdateGame 실패:", e);
    throw e;
  }
};

// [Deleted] adminRentSpecificCopy (Legacy)
// [Deleted] adminReturnSpecificCopy (Legacy)

/**
 * 특정 대여자의 대여 건들을 일괄 반납 처리합니다.
 * targetRentalId가 제공되면 해당 건만 처리합니다.
 * 
 * @param {string} [renterName] - 대여자 이름
 * @param {string} [targetUserId] - 대상 사용자 UUID
 * @param {number} [targetGameId] - 대상 게임 ID
 * @param {string} [targetRentalId] - 특정 대여 기록 UUID
 * @returns {Promise<Object>} 처리 결과 { status, count }
 */
export const returnGamesByRenter = async (renterName, targetUserId, targetGameId, targetRentalId) => {
  // targetGameId나 targetRentalId가 있으면 해당 건만, 없으면 해당 대여자의 모든 대여 건 반납
  let activeRentals = [];

  // 1. 회원 ID 또는 게임 ID로 조회 범위 설정
  const { data, error } = await supabase
    .from('rentals')
    .select('rental_id, game_id, user_id, renter_name')
    .is('returned_at', null)
    .eq('type', 'RENT');

  if (error) {
    console.error("대여 목록 조회 실패:", error);
    return { status: "error", message: error.message };
  }

  // 필터링: 특정 게임 + 특정 유저(또는 이름) 매칭
  activeRentals = data.filter(r => {
    const isRentalMatch = targetRentalId ? r.rental_id === targetRentalId : true;
    const isGameMatch = targetGameId ? r.game_id === targetGameId : true;
    const isUserMatch = targetUserId ? r.user_id === targetUserId : (renterName ? r.renter_name === renterName : true);
    return isRentalMatch && isGameMatch && isUserMatch;
  });

  // 4. 반납 처리 (RPC 사용)
  let successCount = 0;
  if (activeRentals.length > 0) {
    for (const rental of activeRentals) {
      try {
        const gameId = rental.game_id;
        const userId = rental.user_id;
        const renter = rental.renter_name;
        const rentalId = rental.rental_id;

        // [RPC] 관리자 반납 (v2 함수는 game_id, renter_name, user_id 기반)
        const { data: rpcData, error: rpcError } = await supabase.rpc('admin_return_game', {
          p_game_id: gameId,
          p_renter_name: renter,
          p_user_id: userId,
          p_rental_id: rentalId
        });

        if (rpcError) {
          console.error(`[Error] Return RPC Failed(GameID: ${gameId})`, rpcError);
        } else if (!rpcData.success) {
          console.error(`[Fail] Return result false: ${rpcData.message}`);
        } else {
          successCount++;
          // [FIX] 일괄 반납(개별 모달 포함) 처리 시 명시적으로 로그 추가
          await sendLog(gameId, 'RETURN', '관리자 일괄 반납');
        }
      } catch (e) {
        console.error("반납 중 에러:", e);
      }
    }
  }
  return { status: "success", count: successCount };
};

/**
 * 특정 대여자의 찜(예약) 기록을 일괄적으로 대여 상태로 승인(수령) 처리합니다.
 * 
 * @param {string} [renterName] - 대여자 이름
 * @param {string} [userId] - 사용자 UUID
 * @returns {Promise<Object>} 처리 결과 리포트
 */
export const approveDibsByRenter = async (renterName, userId) => {
  let reservedList = [];

  // 1. 회원 ID로 조회
  if (userId) {
    const { data, error } = await supabase
      .from('rentals')
      .select('rental_id, game_id, games(name)') // [FIX] game_copies 제거
      .eq('user_id', userId)
      .eq('type', 'DIBS')
      .is('returned_at', null);

    if (error) console.error("회원 찜 조회 실패:", error);
    if (data) reservedList = [...data];
  }

  // 2. 이름으로 조회 (수기 예약 포함)
  if (renterName) {
    const { data: manualReserved, error } = await supabase
      .from('rentals')
      .select('rental_id, game_id, games(name)') // [FIX]
      .eq('renter_name', renterName)
      .eq('type', 'DIBS')
      .is('returned_at', null);

    if (error) console.error("이름 찜 조회 실패:", error);
    if (manualReserved && manualReserved.length > 0) {
      reservedList = [...reservedList, ...manualReserved];
    }
  }

  // 3. 중복 제거 (rental_id 기준)
  const uniqueRentals = [];
  const seenIds = new Set();
  const alreadyAddedGameIds = new Set(); // 같은 게임 중복 방지 (다중 찜 방지)

  for (const r of reservedList) {
    if (!seenIds.has(r.rental_id)) {
      // (선택) 같은 게임을 여러 번 찜했을 경우 하나만 승인? -> 일단 정책상 중복 찜 불가하므로 그대로 진행
      seenIds.add(r.rental_id);
      uniqueRentals.push(r);
    }
  }

  // 조기 반환: 처리할 찜이 없음
  if (uniqueRentals.length === 0) {
    return {
      status: "success",
      count: 0,
      total: 0,
      failed: 0,
      message: "처리할 찜이 없습니다."
    };
  }

  // 4. [개선] 병렬 처리 + game_id 직접 전달
  const processingPromises = uniqueRentals.map(async (reserved) => {
    // [FIX] game_id 사용
    const gameId = reserved.game_id;
    const gameName = reserved.games?.name || "알 수 없음";

    if (!gameId) {
      return {
        success: false,
        gameName: gameName,
        error: "Game ID 누락"
      };
    }

    try {
      // [FIX] admin_rent_game RPC 사용 (트랜잭션)
      // renterName과 userId를 명확히 전달
      const { data, error } = await supabase.rpc('admin_rent_game', {
        p_game_id: gameId,
        p_renter_name: renterName || "관리자",
        p_user_id: userId || null,
        p_rental_id: reserved.rental_id // [FIX] 특정 찜 기록을 대여로 전환
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      return { success: true, gameName: gameName };

    } catch (e) {
      return {
        success: false,
        gameName: gameName,
        error: e.message || "예외 발생"
      };
    }
  });

  const results = await Promise.allSettled(processingPromises);

  // 결과 집계
  let successCount = 0;
  let failCount = 0;
  const failedGames = [];

  results.forEach((result, idx) => {
    if (result.status === 'fulfilled' && result.value.success) {
      successCount++;
    } else {
      failCount++;
      const errorInfo = result.status === 'fulfilled'
        ? result.value
        : { gameName: uniqueRentals[idx]?.games?.name || '알 수 없음', error: '처리 실패' };
      failedGames.push(errorInfo);
    }
  });

  return {
    status: "success",
    count: successCount,
    total: uniqueRentals.length,
    failed: failCount,
    failedGames: failedGames,
    message: successCount > 0
      ? `${successCount}건 수령 완료${failCount > 0 ? ` (${failCount}건 실패)` : ''} `
      : "모든 처리가 실패했습니다."
  };
};

export const deleteGame = async (gameId) => {
  // 1. 삭제할 게임의 이미지 URL 미리 가져오기
  const { data: gameInfo, error: fetchError } = await supabase
    .from('games')
    .select('image')
    .eq('id', gameId)
    .single();

  if (fetchError) throw fetchError;
  const targetImageUrl = gameInfo?.image;

  // 2. [Updated] 안전 삭제 RPC 사용
  const { data, error } = await supabase.rpc('safe_delete_game', { p_game_id: gameId });

  if (error) throw error;
  if (!data.success) throw new Error(data.message);

  // 3. 이미지 보존 검사 및 스토리지 삭제 진행
  // 삭제 대상 파일이고 실제로 삭제까지 완료(?)된 상황에서만 작동
  if (targetImageUrl && targetImageUrl.includes('supabase.co') && targetImageUrl.includes('/storage/v1/object/public/game-images/')) {
    try {
      // 3-1. 동일한 이미지 URL을 사용하는 다른 게임이 있는지 확인 (해당 게임은 이미 삭제되었으므로 0이어야 안 씀)
      const { count, error: countError } = await supabase
        .from('games')
        .select('id', { count: 'exact', head: true })
        .eq('image', targetImageUrl);

      if (!countError && count === 0) {
        // 3-2. 스토리지 파일명 추출
        const urlParts = targetImageUrl.split('/game-images/');
        if (urlParts.length === 2) {
          const fileName = urlParts[1];
          // 3-3. 스토리지 물리파일 삭제 호출
          const { error: storageError } = await supabase.storage
            .from('game-images')
            .remove([fileName]);

          if (storageError) {
            console.error("Storage image delete failed:", storageError);
          }
        }
      }
    } catch (e) {
      console.error("Error checking/deleting associated image:", e);
    }
  }

  return data;
};

export const fetchGameLogs = async (gameId) => {
  const { data, error } = await supabase
    .from('logs')
    .select('*, profiles(name, phone)')
    .eq('game_id', gameId)
    .order('created_at', { ascending: false });
  if (error) return { status: "error" };

  // 로그 매핑 (type -> 한글 등)은 프론트에서 처리 중.
  // 날짜 컬럼: created_at -> date (DashboardTab expects .date)
  const formatted = data.map(log => ({
    ...log,
    date: log.created_at,
    type: log.action_type,
    value: log.details, // details에 "→ [이름]" 형식이 있거나 단순 텍스트
    userName: log.profiles?.name || null,
    userPhone: log.profiles?.phone || null
  }));
  return { status: "success", logs: formatted };
};

export const fetchAllLogs = async () => {
  const { data, error } = await supabase
    .from('logs')
    .select('*, games(name), profiles(name, phone)')
    .order('created_at', { ascending: false });
  if (error) return { status: "error" };

  const formatted = data.map(log => ({
    ...log,
    date: log.created_at,
    type: log.action_type,
    value: log.details,
    gameName: log.games?.name || "알 수 없음", // 조인된 게임 이름 추가
    userName: log.profiles?.name || null,
    userPhone: log.profiles?.phone || null
  }));
  return { status: "success", logs: formatted };
};

// [MyPage]
export const fetchMyRentals = async (userId) => {
  // rentals -> game_copies -> games (name)
  // Supabase join syntax:
  const { data, error } = await supabase
    .from('rentals')
    .select(`
      rental_id,
      borrowed_at,
      due_date,
      returned_at,
      type,
      game_id,
      games (id, name, image, video_url, manual_url)
    `)
    .eq('user_id', userId)
    .order('borrowed_at', { ascending: false });

  if (error) {
    console.error("내 대여 목록 로딩 실패:", error);
    return { status: "error", message: error.message };
  }

  // 데이터 가공 (Flatten)
  const formatted = data.map(r => ({
    rentalId: r.rental_id,
    borrowedAt: r.borrowed_at,
    dueDate: r.due_date,
    returnedAt: r.returned_at,
    type: r.type || 'RENT',

    // [FIX] games 테이블 직접 참조
    gameId: r.game_id,
    gameName: r.games?.name || "알 수 없는 게임",
    gameImage: r.games?.image,
    videoUrl: r.games?.video_url,
    manualUrl: r.games?.manual_url,

    status: r.returned_at ? "반납완료" : (r.type === "DIBS" ? "찜(예약)" : "대여중")
  }))
    .filter(r => {
      // 1. 이미 반납된 것은 제외 (여긴 원래 같음)
      if (r.returnedAt) return false;

      // [FIX] 2. 찜(DIBS)인데 만료된 것은 숨김
      if (r.type === 'DIBS' && r.dueDate) {
        const due = new Date(r.dueDate);
        const now = new Date();
        if (now > due) return false; // 만료됨 -> 안보여줌
      }

      return true; // 그 외에는 표시
    });

  return { status: "success", data: formatted };
};


// ==========================================
// [Kiosk & Points System APIs]
// ==========================================

/**
 * 특정 사용자의 포인트 거래 내역을 가져옵니다.
 * 
 * @param {string} userId - 사용자 UUID
 * @returns {Promise<Array>} 포인트 거래 내역 배열
 */
export const fetchPointHistory = async (userId) => {
  const { data, error } = await supabase
    .from('point_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("포인트 내역 로딩 실패:", error);
    return [];
  }
  return data;
};

/**
 * 보드게임 매치 결과를 등록하고 포인트(MVP 등)를 지급합니다.
 * 
 * @param {number} gameId - 게임 ID
 * @param {Array<string>} playerIds - 참가자 UUID 배열
 * @param {Array<string>} winnerIds - 승리자 UUID 배열
 * @returns {Promise<Object>} 성공 여부 객체
 */
export const registerMatch = async (gameId, playerIds, winnerIds) => {
  // playerIds, winnerIds: array of UUIDs
  const { data, error } = await supabase.rpc('register_match_result', {
    p_game_id: gameId,
    p_player_ids: playerIds,
    p_winner_ids: winnerIds
  });

  if (error) {
    console.error("Match Register Error:", error);
    return { success: false, message: error.message };
  }
  return { success: true };
};

/**
 * 특정 사용자의 현재 가용 포인트를 조회합니다.
 * 
 * @param {string} userId - 사용자 UUID
 * @returns {Promise<number>} 현재 포인트
 */
export const fetchUserPoints = async (userId) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('current_points')
    .eq('id', userId)
    .single();

  if (error) return 0;
  return data?.current_points || 0;
};

// [NEW] 가입 학기 본인 수정 (1회용)
export const updateMySemester = async (newSemester) => {
  const { data, error } = await supabase.rpc('update_my_semester', { new_semester: newSemester });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.message || '업데이트 실패');
  return data;
};

/**
 * 키오스크용 간편 반납 처리 함수입니다.
 * 
 * @param {number} gameId - 게임 ID
 * @param {string} userId - 사용자 UUID
 * @param {string} [rentalId] - 특정 대여 기록 UUID
 * @returns {Promise<Object>} 처리 결과 객체
 */
export const kioskReturn = async (gameId, userId, rentalId) => {
  const { data, error } = await supabase.rpc('kiosk_return', {
    p_game_id: gameId,
    p_user_id: userId,
    p_rental_id: rentalId
  });

  if (error) {
    console.error("Kiosk Return Error:", error);
    return { success: false, message: error.message };
  }

  // [FIX] 키오스크 반납 로그 명시적 추가
  if (data?.success) {
    await sendLog(gameId, 'RETURN', '키오스크 반납 처리');
  }

  return data;
};

// [Kiosk] 16. 키오스크 간편 대여 (RPC) [NEW]
/**
 * 키오스크용 간편 대여 처리 함수입니다.
 * 
 * @param {number} gameId - 게임 ID
 * @param {string} userId - 사용자 UUID
 * @returns {Promise<Object>} 처리 결과 객체
 */
export const kioskRental = async (gameId, userId) => {
  const { data, error } = await supabase.rpc('kiosk_rental', {
    p_game_id: gameId,
    p_user_id: userId
  });

  if (error) {
    console.error("Kiosk Rental Error:", error);
    return { success: false, message: error.message };
  }
  return data;
};

/**
 * 키오스크에서 예약된 게임을 수령 처리합니다.
 * 
 * @param {string} rentalId - 대여 기록 UUID
 * @returns {Promise<Object>} 처리 결과 객체
 */
export const kioskPickup = async (rentalId) => {
  const { data, error } = await supabase.rpc('kiosk_pickup', {
    p_rental_id: rentalId
  });

  if (error) {
    console.error("Kiosk Pickup Error:", error);
    return { success: false, message: error.message };
  }

  // 수령 이력 로그 기록
  if (data?.success) {
    await sendLog(data?.game_id || null, 'RENT', '키오스크 수령 처리');
  }

  return data;
};

/**
 * 모든 사용자의 최근 포인트 거래 내역을 통합 조회합니다. (관리자용)
 * 
 * @param {number} [limit=50] - 조회할 최대 개수
 * @returns {Promise<Array>} 통합 포인트 거래 내역 배열
 */
export const fetchGlobalPointHistory = async (limit = 50) => {
  const { data, error } = await supabase
    .from('point_transactions')
    .select(`
  *,
  profiles: user_id(name, student_id)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Global Point History Error:", error);
    return [];
  }
  return data;
};

/**
 * 포인트 보유량 기준 상위 사용자 목록을 조회합니다. (리더보드)
 * 
 * @param {number} [limit=10] - 조회할 최대 개수
 * @returns {Promise<Array>} 리더보드 데이터 배열
 */
export const fetchLeaderboard = async (limit = 10) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, student_id, current_points')
    .order('current_points', { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Leaderboard Error:", error);
    return [];
  }
  return data;
};

/**
 * 사용자의 계정을 탈퇴 처리합니다. (기존 데이터 보존 또는 삭제 정책에 따라 처리)
 * 
 * @param {string} userId - 탈퇴할 사용자 UUID
 * @returns {Promise<Object>} RPC 결과 객체
 */
export const withdrawAccount = async (userId) => {
  const { data, error } = await supabase.rpc('withdraw_user', {
    p_user_id: userId
  });

  if (error) {
    console.error("Withdraw Error:", error);
    throw error;
  }
  return data;
};

// [Kiosk] 15. 유저 포인트 조회 (Helper) -> Moved to top (line 806)
// [NEW] 중앙 집중식 로그 전송 함수 (RPC & JSONB 사용)
export const sendLog = async (gameId, actionType, details) => {
  try {
    // [FIX] 상세 정보를 JSON 객체로 구조화 (통계 분석 용이성)
    const structuredDetails = typeof details === 'object' ? details : { value: details };

    await supabase.rpc('send_user_log', {
      p_game_id: gameId || null,
      p_action_type: actionType,
      p_details: structuredDetails
    });
  } catch (error) {
    console.warn("Logging failed:", error.message);
  }
};

// ==========================================
// [Admin] 18. 파손 신고 / 게임 신청 관리 [NEW]
// ==========================================

// 파손 신고 목록 조회
export const fetchDamageReports = async () => {
  const { data, error } = await supabase
    .from('damage_reports')
    .select(`
      *,
      profiles:user_id (name, student_id, phone)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("파손 신고 로딩 실패:", error);
    return [];
  }
  return data;
};

// 파손 신고 상태 변경
export const updateDamageReportStatus = async (reportId, newStatus) => {
  const { error } = await supabase
    .from('damage_reports')
    .update({ status: newStatus })
    .eq('id', reportId);

  if (error) throw error;
};

// 게임 신청 목록 조회
export const fetchGameRequests = async () => {
  const { data, error } = await supabase
    .from('game_requests')
    .select(`
      *,
      profiles:user_id (name, student_id, phone)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("게임 신청 로딩 실패:", error);
    return [];
  }
  return data;
};

// 게임 신청 상태 변경
export const updateGameRequestStatus = async (requestId, newStatus) => {
  const { error } = await supabase
    .from('game_requests')
    .update({ status: newStatus })
    .eq('id', requestId);

  if (error) throw error;
};
