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

// [Public] 활성 월드컵 테마 목록 — [{ slug, title, description, allowed_sizes, pool_count, play_count }]
export const fetchWorldcupThemes = () => callRpc('fun_wc_list_themes');

// [Public] 판 시작 — { run_id, slug, title, size, top_first[], candidates[] }
// candidates 는 대진 순서. top_first[i] 가 true 면 i번째 대결에서 대진상 앞 후보를 위에 둔다.
export const startWorldcup = (slug, size) =>
    callRpc('fun_wc_start', { p_slug: slug, p_size: size, p_anon_id: getFunAnonId() });

// [Public] 판 제출 — picks = 대결 순서대로 [{ w: 승자 game_id, ms: 고른 시간 }]. 결과(getWorldcupRun 과 같은 모양) 반환
export const finishWorldcup = (runId, picks) =>
    callRpc('fun_wc_finish', { p_run_id: runId, p_picks: picks, p_anon_id: getFunAnonId() });

// [Public] 결과 조회 (공유 링크) — 끝나지 않았거나 없는 판이면 null
export const fetchWorldcupRun = (runId) => callRpc('fun_wc_get_run', { p_run_id: runId });

// [Public] 랭킹 — scope: 'member'(기본) | 'all'
export const fetchWorldcupRanking = (slug, scope = 'member') =>
    callRpc('fun_wc_ranking', { p_slug: slug, p_scope: scope });

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
