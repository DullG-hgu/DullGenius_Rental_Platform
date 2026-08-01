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

// 오픈 리다이렉트 방지 — 명시적으로 허용된 내부 경로만 취급한다.
const ALLOWED = /^\/admin-secret(\/[\w\-/:]*)?$/;

/** 로그인 후 돌아갈 경로를 저장 (허용 목록 밖이면 무시) */
export const stashPendingRoute = (path) => {
    if (typeof path !== 'string' || !ALLOWED.test(path)) return;
    try {
        sessionStorage.setItem(KEY, path);
    } catch { /* storage 차단 환경 — 복귀 기능만 포기 */ }
};

/** 저장된 복귀 경로를 꺼내고 비운다. 없거나 부적합하면 null */
export const takePendingRoute = () => {
    try {
        const path = sessionStorage.getItem(KEY);
        sessionStorage.removeItem(KEY);
        return path && ALLOWED.test(path) ? path : null;
    } catch {
        return null;
    }
};
