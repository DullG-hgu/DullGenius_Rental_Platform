// 진행 중인 판을 기기에 저장해 두었다가 "이어하기"로 복구한다.
// 서버 이탈 처리보다 조금 짧게: 비로그인 판 6시간 → 5시간, 로그인 판 3일 → 3일(서버 기록으로도 복구됨)
// localStorage 가 막힌 환경에서는 조용히 저장하지 않는다 (이어하기만 안 될 뿐 플레이는 된다).

const KEY = 'fun_wc_progress';
export const GUEST_TTL_MS = 5 * 60 * 60 * 1000;
export const MEMBER_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const saveProgress = (run, picks, unplayed = [], ttl = GUEST_TTL_MS) => {
    try {
        localStorage.setItem(KEY, JSON.stringify({ run, picks, unplayed, ttl, savedAt: Date.now() }));
    } catch {
        // 저장 불가 환경
    }
};

export const loadProgress = (slug) => {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        const fresh = Date.now() - (saved.savedAt || 0) < (saved.ttl || GUEST_TTL_MS);
        if (!fresh || !saved.run?.run_id || !Array.isArray(saved.picks)) {
            localStorage.removeItem(KEY);
            return null;
        }
        if (slug && saved.run.slug !== slug) return null;
        return saved;
    } catch {
        return null;
    }
};

export const clearProgress = () => {
    try {
        localStorage.removeItem(KEY);
    } catch {
        // 저장 불가 환경
    }
};
