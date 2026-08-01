import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { stashPendingRoute } from '../lib/pendingRoute';

const EXEMPT_ROLES = ['admin', 'executive', 'payment_exempt'];
import { LINKS } from '../infoData';
import logo from '../logo.png'; // [NEW] Logo Import
import LoginTooltip from './LoginTooltip'; // [NEW] Login Tooltip Import
import './Header.css';

const Header = () => {
    const { user, profile, roles, logout, loading: authLoading } = useAuth(); // [FIX] signOut -> logout
    const navigate = useNavigate();
    const { showToast } = useToast();

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

    const isExempt = user && roles.some(r => EXEMPT_ROLES.includes(r));
    const isPaidUser = user && (profile?.is_paid || isExempt);

    return (
        <header className={`hero-header ${isPaidUser ? 'paid-user' : ''}`}>
            {/* 상단: 로그인 정보 & 마이페이지 */}
            <div className="header-top-bar">
                {authLoading ? (
                    // 인증 하이드레이션 중: 로그인 버튼 플래시 방지용 자리 홀더
                    <div className="user-action-group" aria-hidden="true" style={{ visibility: 'hidden' }}>
                        <Link to="/login" className="header-sm-btn">로그인</Link>
                        <Link to="/signup" className="header-sm-btn outline">회원가입</Link>
                    </div>
                ) : user ? (
                    <div className="user-action-group">
                        <span className="user-greeting">
                            <span className="branding-icon">🕊️</span>
                            <span className="user-name">{profile?.name || user?.user_metadata?.full_name || '부원'}님</span>
                        </span>
                        <Link to="/mypage" className="header-sm-btn">마이페이지</Link>
                        <button onClick={handleLogout} className="header-sm-btn outline">로그아웃</button>
                    </div>
                ) : (
                    <div className="user-action-group">
                        <LoginTooltip />
                        <Link to="/login" className="header-sm-btn">로그인</Link>
                        <Link to="/signup" className="header-sm-btn outline">회원가입</Link>
                    </div>
                )}
            </div>

            {/* 하단: 로고 & 메인 액션 */}
            <div className="header-main-bar">
                <div className="branding-container">
                    <img
                        src={logo}
                        alt="덜지니어스 대여소 로고"
                        className="branding-logo-img"
                        onClick={handleLogoClick}
                        style={{ cursor: 'pointer' }}
                    />
                    <Link to="/" className="branding-text-link">
                        <h1 className="branding-text">덜지니어스 대여소</h1>
                    </Link>
                </div>

                {/* [MODIFIED] Hide Join Button for Paid Users */}
                {!isPaidUser && (
                    <a
                        href={LINKS.recruit}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="recruit-pill-btn"
                    >
                        🚀 부원 가입 신청하기
                    </a>
                )}
            </div>
        </header>
    );
};

export default Header;
