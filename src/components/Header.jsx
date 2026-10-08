import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { stashPendingRoute } from '../lib/pendingRoute';
import useAppUpdate from '../hooks/useAppUpdate';
import { formatVersion } from '../lib/appUpdate';
import logo from '../logo.png';
import './Header.css';

// 2026-09-29 메인 개편: 한 줄짜리 작은 헤더. 부원 가입 안내는 메인 본문(Home)으로 옮겼다.

const Header = () => {
    const { user, profile, roles, logout, loading: authLoading } = useAuth(); // [FIX] signOut -> logout
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { updateAvailable, updating, update, result: updateResult } = useAppUpdate();

    // 「업데이트」를 누른 뒤 새로고침된 첫 화면에서 결과를 한 번 알린다
    useEffect(() => {
        if (updateResult === 'ok') showToast(`새 버전으로 바뀜 · ${formatVersion()}`, { type: 'success' });
        if (updateResult === 'failed') showToast('아직 옛 버전 · 앱을 완전히 닫았다가 다시 열기', { type: 'warning' });
    }, [updateResult, showToast]);

    const handleLogout = async () => {
        try {
            await logout(); // [FIX] signOut -> logout
            navigate('/');
        } catch (error) {
            console.error("Logout failed:", error);
        }
    };

    // 숨은 관리자 입구: 로고 5연타 → 진짜 관리자 페이지(/admin-secret)
    //
    // 이건 미끼가 아니라 진짜 입구다. 그래서 의도적으로 "진짜라는 흔적"을 남긴다:
    // 한국어 브랜드 토스트가 뜬다. 허니팟(/admin 등의 가짜 로그인)은 영문 사내 콘솔 톤이고
    // 토스트를 절대 띄우지 않으므로, 운영진은 이 신호만 보고 진짜/가짜를 구분할 수 있다.
    //
    // 비로그인 상태에서는 로그인 페이지로 보내고, 로그인에 성공하면
    // pendingRoute(sessionStorage)가 관리자 페이지로 자동 복귀시킨다.
    // URL에 ?next= 를 붙이지 않는 이유는 그게 경로 존재를 노출하기 때문.
    const LOGO_TAP_TARGET = 5;
    const LOGO_TAP_WINDOW_MS = 1500; // 연타 간격 허용치
    const [logoTaps, setLogoTaps] = React.useState(0);

    React.useEffect(() => {
        if (logoTaps === 0) return undefined;
        const timer = setTimeout(() => setLogoTaps(0), LOGO_TAP_WINDOW_MS);
        return () => clearTimeout(timer);
    }, [logoTaps]);

    const handleLogoClick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const next = logoTaps + 1;
        if (next < LOGO_TAP_TARGET) {
            setLogoTaps(next);
            return;
        }

        setLogoTaps(0);

        const isStaff = roles.some(r => r === 'admin' || r === 'executive');

        if (user && isStaff) {
            showToast('덜지니어스 관리자 페이지로 이동합니다.', { type: 'success' });
            navigate('/admin-secret');
        } else if (!user) {
            // 로그인 후 관리자 페이지로 되돌아오도록 경로만 남겨둔다
            stashPendingRoute('/admin-secret');
            showToast('관리자 로그인이 필요합니다.', { type: 'info' });
            navigate('/login');
        }
        // 로그인했지만 권한이 없으면 아무 반응도 하지 않는다 —
        // 반응을 주면 "숨은 관리자 입구가 존재한다"는 사실만 알려주는 꼴이다.
    };

    // 새 빌드가 있을 때만 두 번째 버튼(로그아웃/회원가입) 자리를 차지한다.
    // 회원가입은 로그인 화면 링크로, 로그아웃은 업데이트 직후 다시 보인다.
    const updateButton = (
        <button type="button" onClick={update} disabled={updating} className="site-header-btn is-update">
            {updating ? '받는 중…' : '업데이트'}
        </button>
    );

    return (
        <header className="site-header">
            <div className="site-brand">
                {/* 로고 5연타 = 숨은 관리자 입구 (위 handleLogoClick) */}
                <img
                    src={logo}
                    alt="덜지니어스 대여소 로고"
                    className="site-brand-logo"
                    onClick={handleLogoClick}
                />
                <Link to="/" className="site-brand-text">덜지니어스 대여소</Link>
            </div>

            <div className="site-header-actions">
                {authLoading ? (
                    // 인증 하이드레이션 중: 로그인 버튼 플래시 방지용 자리 홀더
                    <span className="site-header-btn is-placeholder" aria-hidden="true">로그인</span>
                ) : user ? (
                    <>
                        <Link to="/mypage" className="site-header-btn">
                            {profile?.name || user?.user_metadata?.full_name || '부원'}님
                        </Link>
                        {updateAvailable ? updateButton : (
                            <button type="button" onClick={handleLogout} className="site-header-btn is-ghost">로그아웃</button>
                        )}
                    </>
                ) : (
                    <>
                        <Link to="/login" className="site-header-btn is-primary">로그인</Link>
                        {updateAvailable ? updateButton : (
                            <Link to="/signup" className="site-header-btn is-ghost">회원가입</Link>
                        )}
                    </>
                )}
            </div>
        </header>
    );
};

export default Header;
