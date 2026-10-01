// ==========================================
// [Fun Content APIs] - 놀이 콘텐츠 (이상형 월드컵)
// spec_fun_worldcup.md §8 — 모든 읽기·쓰기는 fun_wc_* RPC 로만
// ==========================================

import { supabase } from './lib/supabaseClient';

const ANON_ID_KEY = 'fun_anon_id';
let memoryAnonId = null;

// 기기 식별자: 비회원 판의 소유 확인·도배 제한용 무작위 UUID (개인정보 아님)
// localStorage 가 막힌 환경(시크릿 모드 등)에서는 탭 수명 동안만 유지된다.
export const getFunAnonId = () => {
    try {
        let id = localStorage.getItem(ANON_ID_KEY);
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem(ANON_ID_KEY, id);
        }
        return id;
    } catch {
        if (!memoryAnonId) memoryAnonId = crypto.randomUUID();
        return memoryAnonId;
    }
};

const callRpc = async (fn, params) => {
    const { data, error } = await supabase.rpc(fn, params);
    if (error) throw error;
    return data;
};

// [Public] 활성 월드컵 테마 목록 — [{ slug, title, description, allowed_sizes, pool_count, total_pool_count, play_count }]
// players 를 주면 그 인원으로 할 수 있는 게임 기준으로 pool_count·allowed_sizes 가 계산된다
export const fetchWorldcupThemes = (players = null) =>
    callRpc('fun_wc_list_themes', players ? { p_players: players } : {});

// [Public] 판 시작 — { run_id, slug, title, size, top_first[], candidates[] }
// candidates 는 대진 순서. top_first[i] 가 true 면 i번째 대결에서 대진상 앞 후보를 위에 둔다.
// players: 고르면 그 인원으로 할 수 있는 게임만 후보 (없으면 전체)
export const startWorldcup = (slug, size, players = null) =>
    callRpc('fun_wc_start', {
        p_slug: slug, p_size: size, p_anon_id: getFunAnonId(), ...(players ? { p_players: players } : {}),
    });

// [Public] 진행 중 기록 — 고를 때(되돌릴 때)마다 지금까지의 선택 전체를 보낸다. 끝까지 안 하고 끈 판의 대결도 모으기 위함.
// 서버 기록 = 마지막으로 보낸 목록 (되돌린 선택은 서버가 지우고 되돌림 기록에 남김).
// seq(보낸 시각 ms)가 더 오래된 요청은 서버가 무시 → 늦게 도착한 요청이 되돌린 선택을 살리지 못한다.
// fire-and-forget 전용: await·catch 없이 불러도 되도록 실패를 삼킨다 (빠진 대결은 다음 전송·finish 가 채움)
export const recordWorldcupPicks = (runId, picks) => {
    supabase
        .rpc('fun_wc_record', { p_run_id: runId, p_picks: picks, p_anon_id: getFunAnonId(), p_seq: Date.now() })
        .then(() => {}, () => {});
};

// [Public] 판 제출 — picks = 대결 순서대로 [{ w: 승자 game_id, ms: 고른 시간, u?: 안 해봄[], p?: 미리 켜진 안 해봄을 끈 게임[] }].
// 회원 판이면 u·p 가 회원별 표시(user_game_marks)에 반영된다. 결과(getWorldcupRun 과 같은 모양) 반환
export const finishWorldcup = (runId, picks) =>
    callRpc('fun_wc_finish', { p_run_id: runId, p_picks: picks, p_anon_id: getFunAnonId(), p_seq: Date.now() });

// [Public] 결과 조회 (공유 링크) — 끝나지 않았거나 없는 판이면 null
export const fetchWorldcupRun = (runId) => callRpc('fun_wc_get_run', { p_run_id: runId });

// [Public] 랭킹 — scope: 'member'(기본) | 'all'
export const fetchWorldcupRanking = (slug, scope = 'member') =>
    callRpc('fun_wc_ranking', { p_slug: slug, p_scope: scope });

// [Public] 「안 해봄」 통계 — 인지도·호기심 승률·경험자 승률·signal(curious|classic|first_impression)
// 칩을 한 번이라도 누른 판만 대상. 표본이 minSample 미만인 지표는 null (spec §6-1)
export const fetchWorldcupInsights = (slug, scope = 'all', minSample = 5) =>
    callRpc('fun_wc_insights', { p_slug: slug, p_scope: scope, p_min: minSample });

// [Member] 내 진행 중인 판 (다른 기기에서 이어하기, 3일) — { run, picks, unplayed, last_activity } 또는 null
export const fetchMyOpenWorldcupRun = (slug = null) =>
    callRpc('fun_wc_my_open_run', slug ? { p_slug: slug } : {});

// [Member] 이 판 후보 중 내가 「안 해봄」으로 표시해 둔(대여 기록 없는) 게임 id[] → 토글 미리 켜기
export const fetchWorldcupPrefill = (runId) => callRpc('fun_wc_my_prefill', { p_run_id: runId });

// [Member] 내 보드게임 취향 — 본인 기록만 (auth.uid() 기준, 비로그인은 호출 불가)
// { runs_finished, runs_total, matches, unplayed_marks, top_picks[], champions[], curious[], genres[] }
export const fetchMyWorldcupProfile = () => callRpc('fun_wc_my_profile');

// [Public] 게임 정보 오류 신고 — field: players | playtime | image | name | other
// shownValue: 신고 당시 화면에 보인 값 (운영진이 무엇을 보고 신고했는지 알 수 있게)
export const reportGameInfo = ({ gameId, field, note = null, shownValue = null, source = 'worldcup' }) =>
    callRpc('report_game_info', {
        p_game_id: gameId, p_field: field, p_note: note, p_shown_value: shownValue,
        p_source: source, p_anon_id: getFunAnonId(),
    });

// [Admin] 정보 오류 신고 목록 / 처리 (status: pending | resolved | dismissed)
export const fetchGameInfoReports = (status = 'pending') =>
    callRpc('admin_list_game_info_reports', { p_status: status });
export const setGameInfoReportStatus = (id, status) =>
    callRpc('admin_set_game_info_report_status', { p_id: id, p_status: status });

// [Admin] 테마 전체 목록 (비활성 포함)
export const fetchWorldcupThemesAdmin = () => callRpc('fun_wc_admin_list_themes');

// [Admin] 필터로 뽑히는 후보 수 미리보기
export const previewWorldcupPool = (filter) => callRpc('fun_wc_admin_preview_pool', { p_filter: filter });

// [Admin] 테마 추가(id 없음) / 수정 — 저장된 테마 id 반환
export const upsertWorldcupTheme = ({ id = null, slug, title, description, filter, allowedSizes, isActive, sortOrder = 0 }) =>
    callRpc('fun_wc_admin_upsert_theme', {
        p_id: id,
        p_slug: slug,
        p_title: title,
        p_description: description,
        p_filter: filter,
        p_allowed_sizes: allowedSizes,
        p_is_active: isActive,
        p_sort_order: sortOrder,
    });

// [Admin] 기간 통계 — slug 생략 시 전체 테마
export const fetchWorldcupAdminStats = ({ slug = null, from, to } = {}) =>
    callRpc('fun_wc_admin_stats', {
        p_slug: slug,
        ...(from ? { p_from: from } : {}),
        ...(to ? { p_to: to } : {}),
    });

// [Admin] 이상 징후 점검
export const fetchWorldcupAbuseCheck = (hours = 24) => callRpc('fun_wc_abuse_check', { p_hours: hours });

// ==========================================
// [성향검사] spec_fun_quiz.md — 로그인 회원만. 채점은 서버(fun_quiz_score)가 한다.
// ==========================================

// [Member] 응답 제출 — answers: 문항 순서대로 −2(A)…+2(B) 19개. 서버가 채점·저장한 결과
// { id, code, four[4], eight[8], answers[19], created_at, previous: { id, code, four, created_at } | null }
export const submitQuiz = (answers, version) =>
    callRpc('fun_quiz_submit', { p_answers: answers, p_consent: true, p_version: version });

// [Member] 내 결과 하나 (본인 것만, 없으면 null)
export const fetchQuizResult = (id) => callRpc('fun_quiz_get_result', { p_id: id });

// [Member] 내 기록 목록 — [{ id, code, four, created_at }] 최신순
export const fetchMyQuizResults = () => callRpc('fun_quiz_my_results');

// [Admin] 기간 통계 — 회원별 최신 1건 기준 { responses, members, by_code, four_avg[4], eight_avg[8] }
export const fetchQuizAdminStats = ({ from, to } = {}) =>
    callRpc('fun_quiz_admin_stats', { ...(from ? { p_from: from } : {}), ...(to ? { p_to: to } : {}) });

// [Member] 내 성향 공개 설정 — { is_public, latest: { id, code, four, created_at } | null }
export const fetchMyQuizPublic = () => callRpc('fun_quiz_my_public');

// [Member] 리뷰 옆 성향 배지 공개 켜기/끄기
export const setQuizPublic = (isPublic) => callRpc('fun_quiz_set_public', { p_public: isPublic });

// [Public] 리뷰 작성자 배지 — 공개를 켠 회원만 { "<user_id>": { code, four } } (최대 100명)
export const fetchQuizBadges = (userIds) => {
    const ids = [...new Set(userIds.filter(Boolean))].slice(0, 100);
    return ids.length ? callRpc('fun_quiz_public_badges', { p_user_ids: ids }) : Promise.resolve({});
};

// [Member] 내 결과 한 건 지우기 — 지웠으면 true (남의 결과·없는 결과면 false)
export const deleteQuizResult = (id) => callRpc('fun_quiz_delete_result', { p_id: id });

// [Member] 내 성향검사 기록 전체 지우기 (리뷰 공개 설정도 함께) — 지운 개수
export const deleteAllMyQuizResults = () => callRpc('fun_quiz_delete_all_mine');
