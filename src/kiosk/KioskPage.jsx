// src/kiosk/KioskPage.js
import React, { useState, useEffect, useRef } from 'react';
import './Kiosk.css';
import { useToast } from '../contexts/ToastContext'; // Toast 알림
import MatchModal from './MatchModal';
import RouletteModal from './RouletteModal';
import ReturnModal from './ReturnModal';
import ReservationModal from './ReservationModal'; // [NEW] 예약 수령 모달

// [Constants]
const IDLE_TIMEOUT_MS = 180000; // 3분 (번인 방지)
const REFRESH_HOUR = 4; // 새벽 4시 자동 새로고침

function KioskPage() {
    const { showToast } = useToast();

    // [State]
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [activationCode, setActivationCode] = useState("");
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

    const idleTimerRef = useRef(null);

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

    // [Effect 1] 초기 인증 체크 & 자동 새로고침 스케줄러
    useEffect(() => {
        // 세션 검증 (만료 시간 체크)
        const validateSession = () => {
            try {
                const stored = JSON.parse(localStorage.getItem('kiosk_session') || 'null');
                if (stored && stored.authorized && stored.expiresAt > Date.now()) {
                    setIsAuthorized(true);
                } else {
                    localStorage.removeItem('kiosk_session');
                }
            } catch {
                localStorage.removeItem('kiosk_session');
            }
        };

        validateSession();

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

    // [Handlers]
    const handleActivation = async () => {
        if (!activationCode.trim()) {
            showToast("마스터 키를 입력해주세요.", { type: "error" });
            return;
        }

        try {
            const res = await fetch('/.netlify/functions/verify-kiosk-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: activationCode }),
            });
            const data = await res.json();

            if (data.success) {
                localStorage.setItem('kiosk_session', JSON.stringify({
                    authorized: true,
                    expiresAt: Date.now() + 86400000, // 24시간
                }));
                setIsAuthorized(true);
                setActivationCode("");
                showToast("기기 인증 완료! 키오스크 모드를 시작합니다.", { type: "success" });

                // [Fullscreen] 강제 전체화면 요청 (브라우저 정책상 사용자 상호작용 필요)
                try {
                    if (document.documentElement.requestFullscreen) {
                        document.documentElement.requestFullscreen();
                    } else if (document.documentElement.webkitRequestFullscreen) {
                        document.documentElement.webkitRequestFullscreen();
                    }
                } catch (err) {
                    console.warn("Fullscreen request failed:", err);
                }
            } else {
                showToast("인증 실패. 마스터 키를 확인하세요.", { type: "error" });
                setActivationCode("");
            }
        } catch (err) {
            showToast("서버 연결 오류. 잠시 후 다시 시도해주세요.", { type: "error" });
            setActivationCode("");
        }
    };

    // [Views]
    if (!isAuthorized) {
        return (
            <div className="activation-screen">
                <h1 style={{ marginBottom: "30px" }}>🔒 기기 인증 필요</h1>
                <input
                    type="password"
                    className="activation-input"
                    placeholder="Master Key 입력"
                    value={activationCode}
                    onChange={(e) => setActivationCode(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleActivation()}
                />
                <button
                    className="kiosk-btn"
                    style={{
                        fontSize: "1rem",
                        padding: "10px 30px",
                        background: "#333",
                        cursor: "pointer"
                    }}
                    onClick={handleActivation}
                >
                    인증하기
                </button>
            </div>
        );
    }

    if (isIdle) {
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
