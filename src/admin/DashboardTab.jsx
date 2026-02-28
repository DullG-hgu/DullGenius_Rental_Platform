// src/admin/DashboardTab.js
import { useState, useEffect } from 'react';
import { adminUpdateGame, deleteGame, approveDibsByRenter, returnGamesByRenter, editGame, fetchGameLogs, fetchUsers } from '../api';
import GameFormModal from './GameFormModal';
import UserSelectModal from './UserSelectModal'; // [NEW]
import ConfirmModal from '../components/ConfirmModal'; // [NEW]
import FilterBar from '../components/FilterBar';
import { TEXTS, getStatusColor } from '../constants';
import { useToast } from '../contexts/ToastContext';
import { useGameFilter } from '../hooks/useGameFilter';
import RentalInstanceList from './components/RentalInstanceList'; // [QUALITY] Component Extracted

function DashboardTab({ games, loading, onReload }) {
  const { showToast } = useToast();

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [targetGame, setTargetGame] = useState(null);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [gameLogs, setGameLogs] = useState([]);
  const [logGameName, setLogGameName] = useState("");

  // [NEW] Confirm 모달 상태
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
    type: "info"
  });

  // [새로운] 유저 선택 모달 상태
  const [userSelectModal, setUserSelectModal] = useState({
    isOpen: false,
    candidates: [],
    game: null,
    renterNameInput: "",
    actionType: "rent" // 'rent' or 'receive'
  });

  // [NEW] Confirm 모달 헬퍼 함수
  const showConfirmModal = (title, message, onConfirm, type = "info") => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, type });
  };

  const closeConfirmModal = () => {
    setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null, type: "info" });
  };

  const [allUsers, setAllUsers] = useState([]);
  // 필터 관련 변수
  const [inputValue, setInputValue] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [renterFilter, setRenterFilter] = useState(""); // 👤 대여자 검색용
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [difficultyFilter, setDifficultyFilter] = useState("전체");
  const [playerFilter, setPlayerFilter] = useState("all");
  const [onlyAvailable, setOnlyAvailable] = useState(false);


  // ⭐ 페이지 로드 시 유저 목록 가져오기
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const users = await fetchUsers(); // api.js에 추가한 함수 호출
        if (Array.isArray(users)) {
          setAllUsers(users);
        }
      } catch (e) {
        console.error("유저 목록 로드 실패:", e);
      }
    };
    loadUsers();
  }, []);

  // ⭐ [헬퍼 함수] 이름으로 User ID 찾기 (단일 매칭 - 구버전 호환용)
  const findUserId = (nameStr) => {
    const matches = findMatchingUsers(nameStr);
    return matches.length > 0 ? matches[0].id : null;
  };

  // ⭐ [NEW] 이름 포함하는 모든 유저 찾기
  const findMatchingUsers = (nameStr) => {
    if (!nameStr) return [];
    if (!allUsers || allUsers.length === 0) return [];

    // 공백 제거 후 비교
    const cleanInput = nameStr.replace(/\s+/g, "");

    return allUsers.filter(u => {
      if (!u.name) return false;
      const cleanUserName = u.name.replace(/\s+/g, "");
      return cleanUserName.includes(cleanInput);
    });
  };

  // 검색어 디바운싱 (0.3초 딜레이)
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(inputValue), 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  /**
   * [HELPER] Get Effective Rental ID
   * @param {Object} game - The game object
   * @param {string|null} rentalId - Provided rentalId (optional)
   * @returns {string|null} - The detected rentalId if unique (INTERNAL USE ONLY)
   */
  const getEffectiveRentalId = (game, rentalId) => {
    // rentalId가 명시적으로 있으면 최우선 (드롭다운/개별 버튼 선택 시)
    if (rentalId) return rentalId;

    // rentalId가 없고, 이 게임을 빌린 사람이 단 1명뿐일 때만 자동 지정
    if (game.rentals?.length === 1) return game.rentals[0].rental_id;
    return null;
  };

  // --- 필터링 로직 (App.js에서 가져옴 + 대여자 필터 추가) ---
  // [개선] Custom Hook 사용
  const filteredGames = useGameFilter(games, {
    searchTerm,
    renterFilter, // Admin 전용
    selectedCategory,
    onlyAvailable,
    difficultyFilter,
    playerFilter,
    sortByName: false // [FIX] Admin.js에서 정한 중요도 순서(찜>대여가능)를 유지하기 위해 이름 정렬 끔
  });

  // 필터 초기화 함수
  const resetFilters = () => {
    setInputValue(""); setSearchTerm(""); setRenterFilter("");
    setSelectedCategory("전체"); setDifficultyFilter("전체");
    setPlayerFilter("all"); setOnlyAvailable(false);
  };

  // 여기까지 필터바 
  // ===================================


  // 카테고리 목록 추출
  const categories = ["전체", ...new Set(games.map(g => g.category).filter(Boolean))];


  // 수정 모달 열기
  const openEditModal = (game) => {
    setTargetGame(game); // 기존 게임 데이터를 그대로 넘김
    setIsEditModalOpen(true);
  };

  // 모달에서 '저장' 버튼 클릭 시
  const handleEditSubmit = async (formData) => {
    showConfirmModal(
      "게임 정보 수정",
      `[${formData.name}] 정보를 수정하시겠습니까?`,
      async () => {
        try {
          let finalImage = formData.image;

          // 이미지 URL이 외부 링크(기존 Supabase URL이 아닌 경우)이면 최적화 진행
          if (finalImage && finalImage.startsWith('http') && !finalImage.includes('supabase.co')) {
            try {
              showToast("이미지를 최적화하고 있습니다...", { type: "info" });

              const cleanUrl = finalImage.replace(/^https?:\/\//, '');
              const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}&w=600&output=webp&il`;

              const response = await fetch(proxyUrl);
              if (!response.ok) {
                throw new Error(`이미지 최적화 서버 응답 에러: ${response.status}`);
              }
              const blob = await response.blob();

              const { supabase: sb } = await import('../lib/supabaseClient');
              const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webp`;

              const { error: uploadError } = await sb.storage
                .from('game-images')
                .upload(fileName, blob, { contentType: 'image/webp' });

              if (uploadError) throw uploadError;

              const { data: { publicUrl } } = sb.storage
                .from('game-images')
                .getPublicUrl(fileName);

              finalImage = publicUrl;
            } catch (imgError) {
              console.error("Image optimization failed (edit):", imgError);
              showToast("이미지 최적화 실패 (원본 사용)", { type: "warning" });
              // 실패해도 원본 URL로 계속 진행
            }
          }

          await editGame({ game_id: targetGame.id, ...formData, image: finalImage });
          showToast("수정되었습니다.", { type: "success" });
          setIsEditModalOpen(false);
          onReload();
        } catch (e) {
          showToast("수정 실패: " + e, { type: "error" });
        }
      }
    );
  };

  // 현장 대여 핸들러 추가
  const handleDirectRent = async (game) => {
    // 1. 대여자 이름 입력받기
    const promptMsg = TEXTS.ADMIN_RENT_PROMPT.replace("{gameName}", game.name);
    const renterName = prompt(promptMsg);
    if (!renterName || renterName.trim() === "") return;

    // 2. 일치하는 유저들 찾기
    const candidates = findMatchingUsers(renterName);

    // [CASE 1] 2명 이상 -> 선택 모달 띄우기
    if (candidates.length > 1) {
      setUserSelectModal({
        isOpen: true,
        candidates: candidates,
        game: game,
        renterNameInput: renterName
      });
      return;
    }

    // [CASE 2] 1명 -> 자동 선택 후 컨펌
    if (candidates.length === 1) {
      proceedRentWithUser(game, renterName, candidates[0]);
      return;
    }

    // [CASE 3] 0명 -> 수기 대여 컨펌
    proceedRentWithUser(game, renterName, null);
  };

  // 실제 대여 처리 (컨펌 포함)
  const proceedRentWithUser = (game, renterNameInput, matchedUser) => {
    let confirmMsg = TEXTS.ADMIN_RENT_CONFIRM_HeadsUp
      .replace("{gameName}", game.name)
      .replace("{renterName}", renterNameInput);

    if (matchedUser) {
      confirmMsg += TEXTS.ADMIN_RENT_CONFIRM_SUCCESS.replace("{userId}", matchedUser.id);
      confirmMsg += `\n(이름: ${matchedUser.name}, 학번: ${matchedUser.student_id || '-'}, 전화: ${matchedUser.phone || '-'})`;
    } else {
      confirmMsg += TEXTS.ADMIN_RENT_CONFIRM_FAIL;
      confirmMsg += "\n(비회원 수기 대여로 진행합니다)";
    }

    showConfirmModal(
      "현장 대여 확인",
      confirmMsg,
      async () => {
        try {
          // matchedUser가 있으면 id 사용, 없으면 null
          const res = await adminUpdateGame(game.id, "대여중", renterNameInput, matchedUser?.id);
          if (res && res.status === "success") {
            showToast(TEXTS.ADMIN_RENT_SUCCESS, { type: "success" });
            onReload();
          } else {
            showToast("오류 발생: " + (res.message || "응답 없음"), { type: "error" });
          }
        } catch (e) {
          console.error(e);
          showToast("처리 실패 (콘솔 확인): " + e, { type: "error" });
        }
      },
      "warning"
    );
  };

  // [새로운] 실제 수령 처리 (컨펌 포함)
  const proceedReceiveWithUser = (game, renterNameInput, matchedUser) => {
    let confirmMsg = `[${game.name}] 현장 수령 확인하시겠습니까?\n\n대여자: ${renterNameInput}`;

    if (matchedUser) {
      confirmMsg += `\n✅ 회원 확인됨 (ID: ${matchedUser.id})`;
      confirmMsg += `\n(이름: ${matchedUser.name}, 학번: ${matchedUser.student_id || '-'}, 전화: ${matchedUser.phone || '-'})`;
    } else {
      confirmMsg += `\n⚠️ 회원 정보 없음 (비회원 수기 수령)`;
    }

    showConfirmModal(
      "수령 확인",
      confirmMsg,
      async () => {
        const res = await approveDibsByRenter(renterNameInput, matchedUser?.id);

        if (res.count > 0) {
          showToast(`${res.message}`, { type: "success" });

          if (res.failed > 0 && res.failedGames && res.failedGames.length > 0) {
            const failedList = res.failedGames.map(f => `${f.gameName} (${f.error})`).join(', ');
            showToast(`⚠️ 실패 목록: ${failedList}`, { type: "warning", duration: 8000 });
          }

          // [FIX] 캐시 무효화 + 강제 새로고침
          localStorage.removeItem('games_cache');
          await onReload();
        } else if (res.total === 0) {
          showToast("⚠️ 처리할 찜이 없습니다. (이미 수령되었거나 만료됨)", { type: "warning" });
          onReload();
        } else {
          showToast(`❌ 처리 실패: ${res.failedGames?.[0]?.error || '알 수 없는 오류'}`, { type: "error" });
          onReload();
        }
      },
      "info"
    );
  };



  const handleStatusChange = async (gameId, newStatus, gameName) => {
    let msg = `[${gameName}] 상태를 '${newStatus}'(으)로 변경하시겠습니까?`;
    if (newStatus === "대여중") msg = "현장 수령 확인하시겠습니까?";
    // [FIX] "대여가능"으로 변경하려는 경우
    if (newStatus === "대여가능") msg = "반납 처리하시겠습니까? (강제 반납)";

    showConfirmModal(
      "상태 변경",
      msg,
      async () => {
        try {
          await adminUpdateGame(gameId, newStatus);
          showToast("처리되었습니다.", { type: "success" });
          onReload();
        } catch (e) {
          showToast("오류 발생: " + e, { type: "error" });
        }
      }
    );
  };

  // 4. 스마트 반납 (일괄 처리 로직)
  const handleReturn = async (game, rentalId) => {
    // [MOD] 특정 rentalId가 '명시적'으로 전달된 경우 (드롭다운 개별 버튼 클릭) 즉시 처리
    if (rentalId) {
      const targetRental = game.rentals?.find(r => r.rental_id === rentalId);
      const renterName = targetRental?.renter_name || targetRental?.profiles?.name || "알 수 없음";

      showConfirmModal(
        "반납 확인",
        `[${game.name}] ${renterName}님의 대여 건을 반납 처리하시겠습니까?`,
        async () => {
          const res = await returnGamesByRenter(null, null, null, rentalId);
          if (res.status === "success" && res.count > 0) {
            showToast("반납되었습니다.", { type: "success" });
            onReload();
          } else {
            showToast(`❌ 반납 처리 실패: ${res.message || '매칭되는 대여 기록이 없거나 DB 오류'}`, { type: "error" });
          }
        }
      );
      return;
    }

    // [MOD] 메인 카드 버튼 클릭 시: 해당 대여자가 빌린 전체 게임 수를 먼저 파악
    const renterName = game.renter; // 예: "A, B" or "A"
    const firstRenter = renterName?.split(',')[0].trim();
    if (!firstRenter) return;

    // [FIX] 모든 게임을 뒤져서 이 사람이 빌린 '전체' 건수 합산 (일괄 처리 여부 결정의 근거)
    const totalUserRentals = games.reduce((acc, g) => {
      const userRentals = g.rentals?.filter(r =>
        r.type === 'RENT' &&
        !r.returned_at &&
        (r.renter_name === firstRenter || r.profiles?.name === firstRenter)
      ) || [];
      return acc + userRentals.length;
    }, 0);

    // 단일 건(이 게임 1통뿐)인 경우 -> 바로 반납 컨펌
    if (totalUserRentals <= 1) {
      const finalRentalId = game.rentals?.[0]?.rental_id;
      showConfirmModal(
        "반납 확인",
        `[${game.name}] ${firstRenter}님의 대여 건을 반납 처리하시겠습니까?`,
        async () => {
          const res = await returnGamesByRenter(null, null, null, finalRentalId);
          if (res.status === "success" && res.count > 0) {
            showToast("반납되었습니다.", { type: "success" });
            onReload();
          } else {
            showToast(`❌ 반납 실패`, { type: "error" });
          }
        }
      );
    } else {
      // 여러 개 빌린 경우 -> 일괄 반납 유도
      showConfirmModal(
        "일괄 반납 확인",
        `💡 [${firstRenter}] 님이 빌려간 게임이 총 ${totalUserRentals}개입니다.\n(다른 게임 포함)\n\n모두 한꺼번에 '반납' 처리하시겠습니까?`,
        async () => {
          await returnGamesByRenter(firstRenter);
          showToast(`${totalUserRentals}건이 일괄 반납되었습니다.`, { type: "success" });
          onReload();
        },
        "warning"
      );
    }
  };

  // 5. [개선] 스마트 수령 (일괄 찜 처리 로직 + 동명이인 처리)
  const handleReceive = async (game, rentalId) => {
    // [MOD] 특정 rentalId가 '명시적'으로 전달된 경우 (드롭다운 개별 버튼 클릭) 즉시 처리
    if (rentalId) {
      const targetRental = game.rentals?.find(r => r.rental_id === rentalId);
      const renterName = targetRental?.renter_name || targetRental?.profiles?.name || "관리자";
      const userId = targetRental?.user_id;

      showConfirmModal(
        "수령 확인",
        `[${game.name}] ${renterName}님의 수령을 확인하시겠습니까?`,
        async () => {
          try {
            const res = await adminUpdateGame(game.id, "대여중", renterName, userId, rentalId);
            if (res.status === "success") {
              showToast("수령 처리되었습니다.", { type: "success" });
              localStorage.removeItem('games_cache');
              onReload();
            }
          } catch (e) {
            showToast(`❌ 수령 처리 실패: ${e.message || '매칭되는 찜 기록이 없거나 DB 오류'}`, { type: "error" });
          }
        }
      );
      return;
    }

    // [2] Bulk 로직
    const renterNameInput = game.renter?.split(',')[0].trim();
    if (!renterNameInput) return;

    // [FIX] 모든 게임을 뒤져서 이 사람이 예약한 '전체' 건수 합산
    const totalUserDibs = games.reduce((acc, g) => {
      const userDibs = g.rentals?.filter(r =>
        r.type === 'DIBS' &&
        !r.returned_at &&
        (r.renter_name === renterNameInput || r.profiles?.name === renterNameInput)
      ) || [];
      return acc + userDibs.length;
    }, 0);

    // [개선] 동명이인 처리
    let userId = game.renterId;
    if (!userId) {
      const candidates = findMatchingUsers(renterNameInput);
      if (candidates.length > 1) {
        setUserSelectModal({
          isOpen: true,
          candidates: candidates,
          game: game,
          renterNameInput: renterNameInput,
          actionType: 'receive'
        });
        return;
      }
      if (candidates.length === 1) userId = candidates[0].id;
    }

    // 단일 수령 처리
    if (totalUserDibs <= 1) {
      const finalRentalId = game.rentals?.[0]?.rental_id;
      showConfirmModal(
        "수령 확인",
        `[${game.name}] 현장 수령 확인하시겠습니까?`,
        async () => {
          const res = await adminUpdateGame(game.id, "대여중", renterNameInput, userId, finalRentalId);
          if (res.status === "success") {
            showToast("수령 완료", { type: "success" });
            localStorage.removeItem('games_cache');
            onReload();
          }
        },
        "info"
      );
    } else {
      // 일괄 수령 처리
      showConfirmModal(
        "일괄 수령 확인",
        `💡 [${renterNameInput}] 님이 예약한 게임이 총 ${totalUserDibs}개입니다.\n\n모두 한꺼번에 '대여중'으로 처리하시겠습니까?\n(취소 누르면 이 게임 하나만 처리합니다)`,
        async () => {
          const res = await approveDibsByRenter(renterNameInput, userId);
          if (res.count > 0) {
            showToast(`${res.count}건 일괄 수령 완료!`, { type: "success" });
            localStorage.removeItem('games_cache');
            onReload();
          } else {
            showToast(`❌ 처리 실패`, { type: "error" });
          }
        },
        "info"
      );
    }
  };

  const handleDelete = async (game) => {
    showConfirmModal(
      "게임 삭제",
      `[${game.name}] 정말 삭제합니까?\n되돌릴 수 없습니다.`,
      async () => {
        try {
          await deleteGame(game.id);
          showToast("삭제되었습니다.", { type: "success" });
          onReload();
        } catch (e) {
          showToast("삭제 실패", { type: "error" });
        }
      },
      "danger"
    );
  };

  // ⭐ [추가] 로그 보기 핸들러
  const handleShowLogs = async (game) => {
    setLogGameName(game.name);
    setGameLogs([]); // 초기화
    setIsLogModalOpen(true);

    try {
      const res = await fetchGameLogs(game.id);


      if (res.status === "success") {
        setGameLogs(res.logs);
      } else {
        showToast("로그를 불러오지 못했습니다.", { type: "error" });
      }
    } catch (e) {
      showToast("로그 로딩 에러", { type: "error" });
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
        <h3>🚨 게임 관리 (총 {games.length}개)</h3>
        <button onClick={onReload} style={{ padding: "5px 10px", cursor: "pointer", background: "var(--admin-card-bg)", color: "var(--admin-text-main)", border: "1px solid var(--admin-border)", borderRadius: "5px" }}>🔄 새로고침</button>
      </div>

      <FilterBar
        inputValue={inputValue} setInputValue={setInputValue}
        selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
        difficultyFilter={difficultyFilter} setDifficultyFilter={setDifficultyFilter}
        playerFilter={playerFilter} setPlayerFilter={setPlayerFilter}
        onlyAvailable={onlyAvailable} setOnlyAvailable={setOnlyAvailable}
        categories={categories}
        onReset={resetFilters}
        isAdmin={true}                   // 관리자 모드 켜기
        renterFilter={renterFilter}      // 대여자 검색 state
        setRenterFilter={setRenterFilter}
      />

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--admin-text-sub)" }}>데이터를 불러오는 중... ⏳</div>
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {filteredGames.map(game => (
            <div key={game.id} className="admin-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <div style={{ fontWeight: "bold", fontSize: "1.05em" }}>
                  {game.name}
                  {/* [MOD] 관리자 화면에서는 adminStatus(예약>대여)를 배지로 표시 */}
                  <span style={{ ...styles.statusBadge, background: getStatusColor(game.adminStatus) }}>
                    {game.adminStatus}
                  </span>

                  {/* [RESTORED] 대여자 이름 표시 (단일 대여 시 가시성 확보) */}
                  {game.renter && (
                    <span style={{ marginLeft: "10px", color: "var(--admin-primary)", fontSize: "0.9em" }}>
                      👤 {game.renter}
                    </span>
                  )}

                  {/* [NEW] 다중 카피 정보 표시 */}
                  {game.quantity >= 2 && (
                    <span style={{ marginLeft: "8px", fontSize: "0.85em", color: "var(--admin-text-sub)", fontWeight: "normal" }}>
                      ({game.rentals ? game.rentals.filter(r => r.type === 'RENT').length : 0}/{game.quantity} 대여중)
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.85em", color: "var(--admin-text-sub)", marginTop: "5px", lineHeight: "1.4" }}>
                  <span style={{ color: "#e67e22", marginRight: "10px" }}>난이도: {game.difficulty || "-"}</span>
                  <span title="유튜브 설명 영상" style={{ cursor: "help", opacity: game.video_url ? 1 : 0.3, marginRight: "5px" }}>
                    {game.video_url ? "📺" : "📺❌"}
                  </span>
                  <span title="추천 멘트" style={{ cursor: "help", opacity: game.recommendation_text ? 1 : 0.3 }}>
                    {game.recommendation_text ? "📝" : "📝❌"}
                  </span>
                  <br />
                  태그: <span style={{ color: "var(--admin-primary)" }}>{game.tags || "(없음)"}</span>
                </div>

                {/* [NEW] 품질 개선: 개별 대여 인스턴스 리스트 (Component Extracted) */}
                {/* [MOD] 2인 이상 빌려간 경우에만 개별 블록 노출 / 1명일 때는 메인 버튼에서 처리 */}
                {game.rentals?.length > 1 && (
                  <RentalInstanceList
                    game={game}
                    onReturn={handleReturn}
                    onReceive={handleReceive}
                  />
                )}
              </div>

              {/* 상태별 버튼 로직 [IMPROVED] */}
              <div style={{ display: "flex", gap: "5px" }}>
                <button onClick={() => handleShowLogs(game)} style={{ ...actionBtnStyle("#2c3e50"), color: "#eee", border: "1px solid #555" }} title="이력 조회">📜</button>
                <button onClick={() => openEditModal(game)} style={actionBtnStyle("#8e44ad")}>✏️ 수정</button>
                <button onClick={() => handleDelete(game)} style={{ ...actionBtnStyle("transparent"), color: "#e74c3c", border: "1px solid #e74c3c", width: "30px", padding: 0 }}>🗑️</button>

                {/* 1. 수령/취소 (예약이 있는 경우) */}
                {((game.rentals && game.rentals.some(r => r.type === 'DIBS')) || game.status === '예약됨') && (
                  <>
                    <button onClick={() => handleReceive(game)} style={actionBtnStyle("#2980b9")} title="해당 사용자의 모든 예약 수령">
                      {game.rentals?.filter(r => r.type === 'DIBS').length > 1 ? "🤝 일괄수령" : "🤝 수령"}
                    </button>
                    <button onClick={() => handleStatusChange(game.id, "대여가능", game.name)} style={actionBtnStyle("#c0392b")}>🚫 취소</button>
                  </>
                )}

                {/* 2. 반납/분실 (대여 중인 건이 있고, 예약된 건이 없는 경우) */}
                {(!game.rentals || !game.rentals.some(r => r.type === 'DIBS')) &&
                  ((game.rentals && game.rentals.some(r => r.type === 'RENT' && !r.returned_at)) || game.active_rental_count > 0) && (
                    <>
                      <button onClick={() => handleReturn(game)} style={actionBtnStyle("#27ae60")} title="해당 사용자의 모든 대여 반납">
                        {game.rentals?.filter(r => r.type === 'RENT' && !r.returned_at).length > 1 ? "↩️ 일괄반납" : "↩️ 반납"}
                      </button>
                      <button onClick={() => handleStatusChange(game.id, "분실", game.name)} style={actionBtnStyle("#7f8c8d")}>⚠️ 분실</button>
                    </>
                  )}

                {/* 3. 현장대여 (재고가 남아있는 경우) */}
                {game.available_count > 0 && (
                  <button onClick={() => handleDirectRent(game)} style={{ ...actionBtnStyle("var(--admin-card-bg)"), marginLeft: "5px" }}>✋ 현장대여</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 공통 모달 사용 (수정용) */}
      <GameFormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        initialData={targetGame}
        onSubmit={handleEditSubmit}
        title="✏️ 게임 정보 수정"
      />

      {isLogModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h3 style={{ marginTop: 0, marginBottom: "15px", borderBottom: "1px solid var(--admin-border)", paddingBottom: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>📜 [{logGameName}] 대여 이력</span>
              <button onClick={() => setIsLogModalOpen(false)} style={{ background: "none", border: "none", fontSize: "1.2em", cursor: "pointer", color: "var(--admin-text-main)" }}>✖️</button>
            </h3>

            <div style={{ maxHeight: "500px", overflowY: "auto", fontSize: "0.9em" }}>
              {gameLogs.length === 0 ? (
                <p style={{ textAlign: "center", color: "var(--admin-text-sub)", padding: "20px" }}>기록이 없습니다.</p>
              ) : (
                <table className="admin-table">
                  <thead style={{ position: "sticky", top: 0, background: "var(--admin-card-bg)", zIndex: 1 }}>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid var(--admin-border)" }}>
                      <th style={{ padding: "10px", width: "130px", color: "var(--admin-text-sub)" }}>날짜</th>
                      <th style={{ padding: "10px", width: "60px", color: "var(--admin-text-sub)", textAlign: "center" }}>행동</th>
                      <th style={{ padding: "10px", color: "var(--admin-text-sub)" }}>내용</th>
                      <th style={{ padding: "10px", width: "150px", color: "var(--admin-text-sub)" }}>대여자 정보</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gameLogs.map((log, idx) => {
                      // [FIX] details(value)가 객체인 경우와 문자열인 경우를 모두 처리 (JSONB 호환성)
                      let valStr = "";
                      if (log.value && typeof log.value === 'object') {
                        // 객체(JSONB)인 경우: message, status, query 등 상황에 맞는 값 추출
                        valStr = log.value.message || log.value.status || log.value.query || JSON.stringify(log.value);
                      } else {
                        valStr = String(log.value || "");
                      }

                      let mainText = valStr;
                      let userInfo = null;
                      let isNonMember = false;

                      if (valStr.includes("→ [")) {
                        const parts = valStr.split("→ [");
                        mainText = parts[0].trim();
                        userInfo = parts[1].replace("]", "").trim();
                      } else if (log.type === "RENT" && valStr.trim() !== "" && valStr !== "일괄처리") {
                        mainText = "현장 대여 (수기)";
                        userInfo = valStr;
                        isNonMember = true;
                      }

                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--admin-border)" }}>
                          <td style={{ padding: "10px 5px", color: "var(--admin-text-sub)", fontSize: "0.85em", minWidth: "80px" }}>
                            {(() => {
                              const dateStr = String(log.date || "");
                              try {
                                const date = new Date(dateStr);
                                if (!isNaN(date.getTime())) {
                                  return date.toLocaleString('ko-KR', {
                                    year: 'numeric', month: '2-digit', day: '2-digit',
                                    hour: '2-digit', minute: '2-digit', hour12: false
                                  });
                                }
                              } catch (e) { }
                              return dateStr.replace(/:[0-9]{2}$/, "").replace("AM", "").replace("PM", "").trim();
                            })()}
                          </td>
                          <td style={{ padding: "10px 5px", textAlign: "center" }}>
                            <span style={{
                              padding: "4px 8px",
                              borderRadius: "4px",
                              fontSize: "0.8em",
                              fontWeight: "bold",
                              color: "white",
                              display: "inline-block",
                              minWidth: "40px",
                              background: log.type === "RENT" ? "#e74c3c" : log.type === "RETURN" ? "#2ecc71" : "#95a5a6"
                            }}>
                              {log.type === "RENT" ? "대여" : log.type === "RETURN" ? "반납" : log.type}
                            </span>
                          </td>
                          <td style={{ padding: "10px 5px", color: "var(--admin-text-main)" }}>
                            {mainText}
                          </td>
                          <td style={{ padding: "10px 5px" }}>
                            {userInfo ? (
                              <div style={{
                                fontSize: "0.9em",
                                color: isNonMember ? "#ccc" : "#0984e3",
                                fontWeight: "600",
                                background: isNonMember ? "#333" : "rgba(9, 132, 227, 0.1)",
                                padding: "4px 8px",
                                borderRadius: "6px",
                                display: "inline-block"
                              }}>
                                👤 {userInfo}
                              </div>
                            ) : (
                              <span style={{ color: "#555", fontSize: "0.8em" }}>-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ marginTop: "20px", textAlign: "right" }}>
              <button
                onClick={() => setIsLogModalOpen(false)}
                style={styles.cancelBtn}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = 'rgba(108, 117, 125, 1)';
                  e.target.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = 'rgba(108, 117, 125, 0.9)';
                  e.target.style.transform = 'translateY(0)';
                }}
                onMouseDown={(e) => {
                  e.target.style.transform = 'translateY(0) scale(0.98)';
                }}
                onMouseUp={(e) => {
                  e.target.style.transform = 'translateY(-1px)';
                }}
              >
                ✕ 닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [NEW] Confirm 모달 */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={closeConfirmModal}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
      />
      {/* [NEW] 유저 선택 모달 (분리됨) */}
      <UserSelectModal
        isOpen={userSelectModal.isOpen}
        onClose={() => setUserSelectModal({ ...userSelectModal, isOpen: false })}
        candidates={userSelectModal.candidates}
        onSelectUser={(u) => {
          setUserSelectModal({ ...userSelectModal, isOpen: false });
          // actionType에 따라 분기 처리
          if (userSelectModal.actionType === 'receive') {
            proceedReceiveWithUser(userSelectModal.game, userSelectModal.renterNameInput, u);
          } else {
            proceedRentWithUser(userSelectModal.game, userSelectModal.renterNameInput, u);
          }
        }}
        onSelectManual={() => {
          setUserSelectModal({ ...userSelectModal, isOpen: false });
          proceedRentWithUser(userSelectModal.game, userSelectModal.renterNameInput, null);
        }}
      />
    </div>
  );
}

const actionBtnStyle = (bgColor) => ({ padding: "6px 12px", border: "1px solid rgba(255,255,255,0.1)", background: bgColor, color: "white", borderRadius: "6px", cursor: "pointer", fontSize: "0.85em", fontWeight: "bold", boxShadow: "0 2px 4px rgba(0,0,0,0.2)" });
const styles = {
  // admin-card class replaces styles.card
  statusBadge: { marginLeft: "8px", fontSize: "0.8em", padding: "2px 8px", borderRadius: "12px", color: "white" },

  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    background: "rgba(0,0,0,0.8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999
  },
  modalContent: { background: "var(--admin-card-bg)", color: "var(--admin-text-main)", padding: "25px", borderRadius: "15px", width: "90%", maxWidth: "800px", boxShadow: "0 5px 20px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto" },
  cancelBtn: { padding: "10px 20px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(108, 117, 125, 0.9)", color: "white", fontWeight: "600", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" }
};

export default DashboardTab;