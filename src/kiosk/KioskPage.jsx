// src/kiosk/KioskPage.js
import React, { useState, useEffect, useRef } from 'react';
import './Kiosk.css';
import { useToast } from '../contexts/ToastContext'; // Toast 알림
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient.jsx';
import MatchModal from './MatchModal';
import RouletteModal from './RouletteModal';
import ReturnModal from './ReturnModal';
import ReservationModal from './ReservationModal'; // [NEW] 예약 수령 모달
import MurderMysteryTimerModal from './MurderMysteryTimerModal'; // [NEW] 머더 미스터리 타이머

// [Constants]
const IDLE_TIMEOUT_MS = 180000; // 3분 (번인 방지)
const REFRESH_HOUR = 4; // 새벽 4시 자동 새로고침

function KioskPage() {
    const { showToast } = useToast();
    const { user, hasRole, logout, loading: authLoading } = useAuth();

    // [State]
    const [isIdle, setIsIdle] = useState(false);
    // Track usage to prevent reload during activity
    const isIdleRef = useRef(false);
    const gracePeriodEndRef = useRef(0); // 유예 기간 종료 시각

    // [Clock State]
    const [currentTime, setCurrentTime] = useState(new Date());

    // [Modals State]
    const [showReturnModal, setShowReturnModal] = useState(false);
    const [showMatchModal, setShowMatchModal] = useState(false);
    const [showRouletteModal, setShowRouletteModal] = useState(false);
    const [showReservationModal, setShowReservationModal] = useState(false); // [NEW]
    const [showMurderMysteryTimer, setShowMurderMysteryTimer] = useState(false); // [NEW] 머더 미스터리

    const idleTimerRef = useRef(null);
    const timerActiveRef = useRef(false); // [NEW] 머더 미스터리 타이머 켜짐 여부

    // [Helper] Set grace period
    const setGracePeriod = (minutes) => {
        const graceMs = minutes * 60 * 1000;
        gracePeriodEndRef.current = Date.now() + graceMs;
        // 타이머 재설정
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
        }
        if (!isIdle) {
            scheduleIdleTimer();
        }
    };

    const scheduleIdleTimer = () => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

        // [NEW] 머더 미스터리 타이머가 켜져있으면 유휴 타이머 실행 안 함
        if (timerActiveRef.current) {
            return;
        }

        const now = Date.now();
        const timeUntilGraceEnd = gracePeriodEndRef.current - now;

        if (timeUntilGraceEnd > 0) {
            // 유예 기간 중이면 유예 기간 종료 후에 타이머 시작
            idleTimerRef.current = setTimeout(() => {
                scheduleIdleTimer(); // 유예 종료 후 정상 타이머 시작
            }, timeUntilGraceEnd);
        } else {
            // 정상 타이머 설정
            idleTimerRef.current = setTimeout(() => {
                setIsIdle(true);
                isIdleRef.current = true;
            }, IDLE_TIMEOUT_MS);
        }
    };

    const [loginError, setLoginError] = useState(null);
    const [manualEmail, setManualEmail] = useState('');
    const [manualPassword, setManualPassword] = useState('');
    const [manualLoading, setManualLoading] = useState(false);

    const handleManualLogin = async (e) => {
        e.preventDefault();
        setManualLoading(true);
        const { error } = await supabase.auth.signInWithPassword({ email: manualEmail, password: manualPassword });
        setManualLoading(false);
        if (error) setLoginError(`로그인 실패: ${error.message}`);
        else setLoginError(null);
    };

    // [Effect] Kiosk 자동 로그인: 세션 없을 때만 env var 계정으로 자동 sign-in
    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            const email = import.meta.env.VITE_KIOSK_EMAIL;
            const password = import.meta.env.VITE_KIOSK_PASSWORD;
            if (!email || !password) {
                setLoginError('환경변수(VITE_KIOSK_EMAIL, VITE_KIOSK_PASSWORD)가 설정되지 않았습니다.');
                return;
            }
            supabase.auth.signInWithPassword({ email, password })
                .then(({ error }) => {
                    if (error) setLoginError(`로그인 실패: ${error.message}`);
                })
                .catch((err) => setLoginError(`연결 오류: ${err.message}`));
        }
    }, [authLoading, user]);

    // [Effect 1] 자동 새로고침 스케줄러
    useEffect(() => {
        // 새벽 4시 리프레시 체크 (1분마다)
        const refreshInterval = setInterval(() => {
            const now = new Date();
            // Check if it's 4 AM AND user is idle to prevent interruption
            if (now.getHours() === REFRESH_HOUR && now.getMinutes() === 0) {
                if (isIdleRef.current) {
                    window.location.reload();
                } else {

                }
            }
        }, 60000);

        return () => clearInterval(refreshInterval);
    }, []);

    // [Effect: Wake Lock] Prevent screen sleep
    useEffect(() => {
        let wakeLock = null;
        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                }
            } catch (err) {

            }
        };
        requestWakeLock();

        const handleVisibilityChange = () => {
            if (wakeLock !== null && document.visibilityState === 'visible') {
                requestWakeLock();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (wakeLock) wakeLock.release();
        };
    }, []);

    // [Effect 2] 실시간 시계 (1초마다 업데이트 - 리소스 소모 미미함)
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // [Effect 3] 유휴 시간 감지 (Screen Saver)
    useEffect(() => {
        const resetTimer = () => {
            if (isIdle) {
                setIsIdle(false);
                isIdleRef.current = false;
            }
            scheduleIdleTimer();
        };

        // 터치/클릭 이벤트 리스너 -> 타이머 초기화
        window.addEventListener('click', resetTimer);
        window.addEventListener('touchstart', resetTimer);
        window.addEventListener('mousemove', resetTimer);

        resetTimer(); // 초기 실행

        return () => {
            window.removeEventListener('click', resetTimer);
            window.removeEventListener('touchstart', resetTimer);
            window.removeEventListener('mousemove', resetTimer);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // isIdle 제거 - 한 번만 설정

    // [Views]
    const isAuthorized = !authLoading && user && (hasRole('kiosk') || hasRole('admin') || hasRole('executive'));

    if (!isAuthorized) {
        // 로그인은 됐지만 kiosk role이 아닌 경우 (일반 유저가 /kiosk 접근)
        if (!authLoading && user && !hasRole('kiosk')) {
            return (
                <div className="activation-screen">
                    <h1 style={{ marginBottom: "20px" }}>🔒 접근 불가</h1>
                    <p style={{ color: "#888", fontSize: "1rem" }}>키오스크 전용 페이지입니다.</p>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", marginTop: "20px" }}>
                        <button
                            onClick={logout}
                            style={{ padding: "10px 24px", background: "#667eea", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                        >
                            키오스크로 전환
                        </button>
                        <a href="/" style={{ color: "#666", fontSize: "0.85rem" }}>홈으로 돌아가기</a>
                    </div>
                </div>
            );
        }
        // 에러 발생 시
        if (loginError) {
            return (
                <div className="activation-screen">
                    <h1 style={{ marginBottom: "20px" }}>⚠️ 오류</h1>
                    <p style={{ color: "#e74c3c", fontSize: "0.95rem", maxWidth: "400px", textAlign: "center", marginBottom: "24px" }}>{loginError}</p>
                    <form onSubmit={handleManualLogin} style={{ display: "flex", flexDirection: "column", gap: "10px", width: "280px" }}>
                        <input
                            type="email"
                            placeholder="이메일"
                            value={manualEmail}
                            onChange={(e) => setManualEmail(e.target.value)}
                            style={{ padding: "10px 14px", borderRadius: "6px", border: "1px solid #444", background: "#1a1a2e", color: "#fff", fontSize: "0.95rem" }}
                            required
                        />
                        <input
                            type="password"
                            placeholder="비밀번호"
                            value={manualPassword}
                            onChange={(e) => setManualPassword(e.target.value)}
                            style={{ padding: "10px 14px", borderRadius: "6px", border: "1px solid #444", background: "#1a1a2e", color: "#fff", fontSize: "0.95rem" }}
                            required
                        />
                        <button type="submit" disabled={manualLoading} style={{ padding: "10px 24px", background: "#667eea", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", opacity: manualLoading ? 0.7 : 1 }}>
                            {manualLoading ? "로그인 중..." : "로그인"}
                        </button>
                    </form>
                    <button onClick={() => window.location.reload()} style={{ marginTop: "12px", padding: "8px 20px", background: "transparent", color: "#888", border: "1px solid #444", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem" }}>새로고침</button>
                </div>
            );
        }
        return (
            <div className="activation-screen">
                <h1 style={{ marginBottom: "20px" }}>🎲 덜지니어스 키오스크</h1>
                <p style={{ color: "#888", fontSize: "1rem" }}>키오스크 계정으로 로그인하는 중...</p>
                <div className="spinner" style={{ marginTop: "20px" }} />
            </div>
        );
    }

    if (isIdle && !showMurderMysteryTimer) {
        return <ScreenSaver onWake={() => setIsIdle(false)} />;
    }

    return (
        <div className="kiosk-container">
            {/* 상단바 */}
            <header style={{ padding: "20px", borderBottom: "1px solid #333", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>🎲 덜지니어스 키오스크</div>
                <div style={{ fontSize: "1.3rem", color: "#888", fontFamily: "'Courier New', Consolas, monospace", fontWeight: "600", letterSpacing: "2px" }}>
                    {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
            </header>

            {/* 메인 대시보드 */}
            <div className="kiosk-dashboard">
                <button className="kiosk-btn btn-match" onClick={() => setShowMatchModal(true)}>
                    <div className="btn-icon">⚔️</div>
                    매치 등록
                    <span style={{ fontSize: "1rem", marginTop: "10px", fontWeight: "normal" }}>승자 +200P / 패자 +50P</span>
                </button>

                <button className="kiosk-btn" style={{ background: "linear-gradient(135deg, #FF9966 0%, #FF5E62 100%)" }} onClick={() => setShowReservationModal(true)}>
                    <div className="btn-icon">📥</div>
                    찜 수령하기
                    <span style={{ fontSize: "1rem", marginTop: "10px", fontWeight: "normal" }}>웹에서 찜한 게임 수령</span>
                </button>

                <button className="kiosk-btn btn-return" onClick={() => setShowReturnModal(true)}>
                    <div className="btn-icon">📦</div>
                    반납하기
                    <span style={{ fontSize: "1rem", marginTop: "10px", fontWeight: "normal" }}>대여중인 게임 반납</span>
                </button>

                <button className="kiosk-btn btn-roulette" onClick={() => setShowRouletteModal(true)}>
                    <div className="btn-icon">🎰</div>
                    게임 추천
                    <span style={{ fontSize: "1rem", marginTop: "10px", fontWeight: "normal" }}>뭐 할지 모를 때!</span>
                </button>


            </div>

            {/* 플로팅 수령 버튼 (좌측 하단) */}
            <button className="floating-receive-btn" onClick={() => setShowReservationModal(true)}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: '2.5rem' }}>📥</div>
                    <div style={{ fontSize: '1.2rem', marginTop: '8px', fontWeight: 'bold', whiteSpace: 'nowrap', letterSpacing: '0.5px' }}>
                        수령하기
                    </div>
                </div>
            </button>

            {/* 플로팅 타이머 버튼 (우측 상단) */}
            <button className="floating-timer-btn" onClick={() => {
                setShowMurderMysteryTimer(true);
                timerActiveRef.current = true;
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: '2.2rem' }}>⏱️</div>
                    <div style={{ fontSize: '0.9rem', marginTop: '4px', fontWeight: 'bold', whiteSpace: 'nowrap', letterSpacing: '0.5px' }}>
                        타이머
                    </div>
                </div>
            </button>

            {/* 플로팅 반납 버튼 (우측 하단) */}
            <button className="floating-return-btn" onClick={() => setShowReturnModal(true)}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: '2.5rem' }}>📦</div>
                    <div style={{ fontSize: '1.2rem', marginTop: '8px', fontWeight: 'bold', whiteSpace: 'nowrap', letterSpacing: '0.5px' }}>
                        반납하기
                    </div>
                </div>
            </button>



            {/* 매치 모달 */}
            {showMatchModal && <MatchModal onClose={() => {
                setShowMatchModal(false);
                setGracePeriod(5); // 매치 등록 후 5분 유예
            }} />}

            {/* 룰렛 모달 */}
            {showRouletteModal && <RouletteModal onClose={() => setShowRouletteModal(false)} />}

            {/* 반납 모달 */}
            {showReturnModal && <ReturnModal onClose={() => {
                setShowReturnModal(false);
                setGracePeriod(3); // 반납 후 3분 유예
            }} />}

            {/* [NEW] 예약 수령 모달 */}
            {showReservationModal && <ReservationModal onClose={() => setShowReservationModal(false)} />}

            {/* [NEW] 머더 미스터리 타이머 모달 */}
            {showMurderMysteryTimer && <MurderMysteryTimerModal onClose={() => {
                setShowMurderMysteryTimer(false);
                timerActiveRef.current = false;
                setGracePeriod(1); // 타이머 종료 후 1분 유예
            }} />}
        </div>
    );
}

// [Sub Component] Screen Saver
function ScreenSaver({ onWake }) {
    const [position, setPosition] = useState({ top: 30, left: 30 });

    // Pixel Shift (10초마다 위치 이동)
    useEffect(() => {
        const interval = setInterval(() => {
            const top = Math.floor(Math.random() * 80) + 10; // 10% ~ 90%
            const left = Math.floor(Math.random() * 80) + 10;
            setPosition({ top, left });
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="screen-saver" onClick={onWake} onTouchStart={onWake}>
            <div className="saver-content" style={{ top: `${position.top}%`, left: `${position.left}%` }}>
                🎲 DullGenius
                <div style={{ fontSize: "1rem", marginTop: "10px" }}>Touch to Wake Up</div>
            </div>
        </div>
    );
}

export default KioskPage;
