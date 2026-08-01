import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { stashPendingRoute } from '../lib/pendingRoute';

// 보호 경로에 도달한 사람을 세 갈래로 나눈다.
//
//  1) 권한 있는 로그인 유저   → 통과
//  2) 로그아웃 상태           → 로그인으로. 원래 가려던 경로를 저장해 로그인 후 되돌린다.
//  3) 로그인했지만 권한 없음   → 아무 단서 없이 홈으로
//
// 예전에는 2·3번에서 "🔒 로그인이 필요합니다" / "🚫 접근 권한이 없습니다" 안내를 띄웠다.
// 그 화면 자체가 "이 경로에 관리자 페이지가 실제로 있다"는 확인을 해주는 셈이라 없앴다.
// 지금은 아무 설명 없이 이동시킨다 — 정상 사용자는 로그인 후 자동 복귀하므로
// 안내가 없어도 불편하지 않고, 경로를 찔러보는 쪽에는 아무 정보도 주지 않는다.
const ProtectedRoute = ({ allowedRoles = [] }) => {
    const { user, hasRole, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <p style={{ marginTop: "20px", color: "#666" }}>권한 확인 중...</p>
            </div>
        );
    }

    if (!user) {
        // 로그인 후 원래 가려던 관리자 경로로 되돌리기 위해 저장.
        // URL 쿼리(?next=)를 쓰지 않는 이유는 그게 경로 존재를 노출하기 때문.
        stashPendingRoute(location.pathname);
        return <Navigate to="/login" replace />;
    }

    const hasPermission = allowedRoles.length === 0 ||
        allowedRoles.some(role => hasRole(role));

    if (!hasPermission) {
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
};

export default ProtectedRoute;
