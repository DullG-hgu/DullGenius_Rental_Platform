// src/lib/pendingRoute.js
// 최종 수정일: 2026.08.01
//
// 보호 경로 접근이 로그인 화면으로 튕겼을 때, 로그인 후 원래 가려던 곳으로 되돌리기 위한 저장소.
//
// 왜 URL 쿼리(?next=/admin-secret)가 아니라 sessionStorage인가:
//   ?next= 를 쓰면 주소창에 관리자 경로가 그대로 남아, 비로그인 상태로 찔러본 사람에게
//   "그 경로가 실제로 존재한다"고 확인해주는 꼴이 된다.
//   sessionStorage에 두면 정상 사용자만 복귀 혜택을 받고 외부에는 아무 신호도 새지 않는다.

const KEY = 'pr';

// 로그인·가입 후 복귀할 수 있는 앱 내부 화면만 허용한다.
const ALLOWED = /^(?:\/admin-secret(?:\/[\w-]+)*|\/event\/[\w-]+(?:\/[\w-]+)?|\/game\/\d+|\/mypage|\/search|\/categories|\/)$/;

export const getSafeReturnPath = (path) => {
    if (typeof path !== 'string' || /[\\\s]/.test(path)) return null;
    try {
        const url = new URL(path, 'https://app.invalid');
        if (!path.startsWith('/') || url.origin !== 'https://app.invalid') return null;
        if (!ALLOWED.test(url.pathname)) return null;
        return url.pathname + url.search;
    } catch { return null; }
};

/** 로그인 후 돌아갈 경로를 저장 (허용 목록 밖이면 무시) */
export const stashPendingRoute = (path) => {
    const safePath = getSafeReturnPath(path);
    if (!safePath) return;
    try {
        sessionStorage.setItem(KEY, safePath);
    } catch { /* storage 차단 환경 — 복귀 기능만 포기 */ }
};

/** 저장된 복귀 경로를 꺼내고 비운다. 없거나 부적합하면 null */
export const takePendingRoute = (requestedPath) => {
    let savedPath = null;
    try {
        savedPath = sessionStorage.getItem(KEY);
        sessionStorage.removeItem(KEY);
    } catch { /* Explicit return links still work when storage is unavailable. */ }
    return getSafeReturnPath(requestedPath) || getSafeReturnPath(savedPath);
};
