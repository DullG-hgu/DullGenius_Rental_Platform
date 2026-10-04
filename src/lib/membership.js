// src/lib/membership.js
// 화면에서 "부원(회비 납부 또는 면제)인가"를 가르는 기준 — 홈 배너·대여 튜토리얼이 같이 쓴다.
// 회비 상태는 학기 종료 때 일괄 초기화되므로, 학기 초엔 기존 부원도 납부 전까지 비부원으로 보인다.
// 실제 대여 허용 여부는 서버(키오스크 RPC의 회비 검사)가 정한다. 여기는 안내 문구 분기용.

const EXEMPT_ROLES = ['admin', 'executive', 'payment_exempt'];

export const isPaidMember = (user, profile, roles = []) =>
    Boolean(user && (profile?.is_paid || roles.some((r) => EXEMPT_ROLES.includes(r))));
