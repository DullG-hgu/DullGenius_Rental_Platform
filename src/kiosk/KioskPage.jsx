// src/kiosk/KioskPage.js
import React, { useState, useEffect, useRef } from 'react';
import './Kiosk.css';
import { useToast } from '../contexts/ToastContext'; // Toast 알림
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient.jsx';
import RouletteModal from './RouletteModal';
import ReturnModal from './ReturnModal';
import ReservationModal from './ReservationModal'; // [NEW] 예약 수령 모달
import MurderMysteryTimerModal from './MurderMysteryTimerModal'; // [NEW] 머더 미스터리 타이머
import siteQr from './assets/site-qr.svg'; // 동아리 사이트 QR (빌드 시 고정 생성: scripts/gen_kiosk_qr.mjs)

const SITE_URL = 'https://dullgrental.netlify.app/';

// [Constants]
const IDLE_TIMEOUT_MS = 180000; // 3분 (번인 방지)
const REFRESH_HOUR = 4; // 새벽 4시 자동 새로고침
const DEVICE_KEY_STORAGE = 'kiosk_device_key';
const LEGACY_KIOSK_HOST = 'dullgboardgamerent.netlify.app';
const CANONICAL_KIOSK_ORIGIN = 'https://dullgrental.netlify.app';

// 세션 발급이 네트워크 오류로 실패했을 때의 재시도 간격 (지수 백오프)
const SESSION_RETRY_BASE_MS = 5000;
const SESSION_RETRY_MAX_MS = 60000;

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

    // ── 키오스크 기기 인증 ──────────────────────────────────────────
    //
    // 예전에는 VITE_KIOSK_EMAIL / VITE_KIOSK_PASSWORD 로 여기서 바로 로그인했다.
    // 그런데 VITE_ 접두 환경변수는 빌드 시 번들에 문자열로 박히기 때문에,
    // 배포된 JS 를 열면 키오스크 계정 아이디·비밀번호가 그대로 보였다.
    // 비밀번호를 바꿔도 다음 빌드에 새 비밀번호가 똑같이 박히므로 구조를 바꿨다.
    //
    // 지금은 기기에 저장된 "마스터키"만 서버로 보내고,
    // 서버(netlify/functions/kiosk-session.js)가 대신 로그인해 세션 토큰만 돌려준다.
    // 계정 자격증명은 서버에만 존재한다.
    //
    // 마스터키가 없으면(새 기기·초기화 후) 운영진이 1회 입력하는 화면을 띄운다.
    const [loginError, setLoginError] = useState(null);
    const [deviceKeyInput, setDeviceKeyInput] = useState('');
    const [provisioning, setProvisioning] = useState(false);
    const [needsDeviceKey, setNeedsDeviceKey] = useState(false);
    // 네트워크 오류로 세션을 못 받아 스스로 재시도하는 중인지
    const [reconnecting, setReconnecting] = useState(false);
    // 세션 요청이 effect 재실행으로 중복 발사되는 것을 막는다
    const sessionRequestedRef = useRef(false);
    const retryTimerRef = useRef(null);
    const retryAttemptRef = useRef(0);

    const readDeviceKey = () => {
        try {
            return localStorage.getItem(DEVICE_KEY_STORAGE);
        } catch {
            return null;
        }
    };

    const clearSessionRetry = () => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
        retryAttemptRef.current = 0;
    };

    // 네트워크 오류 전용 재시도. 저장된 키가 살아 있을 때만 부른다.
    const scheduleSessionRetry = (key) => {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        const delay = Math.min(
            SESSION_RETRY_BASE_MS * (2 ** retryAttemptRef.current),
            SESSION_RETRY_MAX_MS
        );
        retryAttemptRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            requestKioskSession(key);
        }, delay);
    };

    const requestKioskSession = async (key, { persist = false } = {}) => {
        setProvisioning(true);
        setLoginError(null);

        try {
            const response = await fetch('/.netlify/functions/kiosk-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key }),
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data.success) {
                // 키가 틀렸으면 저장된 값을 지워 재입력을 유도한다
                if (response.status === 401) {
                    try { localStorage.removeItem(DEVICE_KEY_STORAGE); } catch { /* 무시 */ }
                }
                // 서버가 응답한 실패는 재시도로 풀리지 않는다. 자동 재시도를 멈추고 사람을 부른다.
                clearSessionRetry();
                setReconnecting(false);
                setNeedsDeviceKey(true);
                const message = response.status === 405
                    ? '이전 배포 주소에서는 기기 등록 요청이 전달되지 않습니다. 새 키오스크 주소로 다시 접속해 주세요.'
                    : data?.message || '기기 인증에 실패했습니다.';
                setLoginError(message);
                return;
            }

            const { error } = await supabase.auth.setSession({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
            });

            if (error) {
                clearSessionRetry();
                setReconnecting(false);
                setNeedsDeviceKey(true);
                setLoginError(`세션 적용 실패: ${error.message}`);
                return;
            }

            if (persist) {
                try { localStorage.setItem(DEVICE_KEY_STORAGE, key); } catch { /* 무시 */ }
            }

            if (data.key_rotation_required) {
                // 이전 키의 유예 접속은 허용하되, 다음 만료 전에 현재 키로 재등록하게 한다.
                try { localStorage.removeItem(DEVICE_KEY_STORAGE); } catch { /* 무시 */ }
                clearSessionRetry();
                setReconnecting(false);
                setNeedsDeviceKey(true);
                setLoginError('기기 등록 키가 교체되었습니다. 운영진에게 새 키를 받아 다시 등록해 주세요.');
                return;
            }

            clearSessionRetry();
            setReconnecting(false);
            setNeedsDeviceKey(false);
            setDeviceKeyInput('');
        } catch (err) {
            // 네트워크 오류는 키 문제가 아니므로 저장된 키를 지우지 않는다.
            //
            // 예전에는 여기서 바로 기기 등록 화면을 띄웠는데, 그게 무인 운영을 깼다.
            // 오피스아워 밖에는 사람이 없어서 와이파이가 잠깐 끊긴 것만으로도
            // 태블릿이 "기기 등록" 화면인 채 다음 방문자까지 방치됐다.
            // 저장된 키가 멀쩡하면 사람을 부르지 말고 스스로 다시 붙는다.
            const storedKey = readDeviceKey();
            if (storedKey) {
                setLoginError(null);
                setNeedsDeviceKey(false);
                setReconnecting(true);
                scheduleSessionRetry(storedKey);
            } else {
                setNeedsDeviceKey(true);
                setLoginError(`연결 오류: ${err.message}`);
            }
        } finally {
            setProvisioning(false);
        }
    };

    const handleDeviceKeySubmit = async (e) => {
        e.preventDefault();
        if (!deviceKeyInput.trim()) return;
        sessionRequestedRef.current = true;
        await requestKioskSession(deviceKeyInput.trim(), { persist: true });
    };

    // [Effect] manifest link 교체 — SPA 라우팅으로 /kiosk 진입 시 index.html의 document.write가 다시 실행되지 않으므로,
    // 여기서 직접 /manifest-kiosk.json 으로 교체해야 PWA 설치 시 키오스크 매니페스트(start_url=/kiosk)가 적용됨
    useEffect(() => {
        if (window.location.hostname === LEGACY_KIOSK_HOST) {
            const nextUrl = `${CANONICAL_KIOSK_ORIGIN}${window.location.pathname}${window.location.search}${window.location.hash}`;
            window.location.replace(nextUrl);
            return;
        }

        const link = document.querySelector('link[rel="manifest"]');
        if (!link) return;
        const previousHref = link.getAttribute('href');
        if (previousHref !== '/manifest-kiosk.json') {
            link.setAttribute('href', '/manifest-kiosk.json');
        }
        return () => {
            if (previousHref && previousHref !== '/manifest-kiosk.json') {
                link.setAttribute('href', previousHref);
            }
        };
    }, []);

    // [Effect] Kiosk 세션 자동 복구
    //
    // 기기에 저장된 마스터키로 서버에 세션을 요청한다. 무인 상태에서 세션이 만료되거나
    // 재부팅돼도 사람 없이 스스로 복구되는 것이 이 방식의 목적이다.
    // 저장된 키가 없으면(새 기기·캐시 초기화 후) 운영진이 1회 입력하는 화면을 띄운다.
    useEffect(() => {
        // 옛 origin의 301은 POST를 GET으로 바꿀 수 있으므로 세션 요청보다 주소 이전을 우선한다.
        if (window.location.hostname === LEGACY_KIOSK_HOST) return;
        if (authLoading) return;

        if (user) {
            // 세션이 살아있으면 다음 만료에 대비해 재시도 플래그를 풀어둔다
            sessionRequestedRef.current = false;
            return;
        }

        if (sessionRequestedRef.current) return;
        sessionRequestedRef.current = true;

        const storedKey = readDeviceKey();
        if (!storedKey) {
            setNeedsDeviceKey(true);
            return;
        }

        requestKioskSession(storedKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user]);

    // [Effect] 재연결 대기 중 네트워크가 돌아오면 백오프를 기다리지 않고 바로 붙는다.
    // 언마운트 시 예약된 재시도도 함께 정리한다.
    useEffect(() => {
        if (!reconnecting) return undefined;

        const handleOnline = () => {
            const storedKey = readDeviceKey();
            if (!storedKey) return;
            clearSessionRetry();
            requestKioskSession(storedKey);
        };

        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reconnecting]);

    useEffect(() => clearSessionRetry, []);

    // [Effect 1] 자동 새로고침 스케줄러
    useEffect(() => {
        // 새벽 4시 리프레시 체크 (1분마다)
        const refreshInterval = setInterval(async () => {
            const now = new Date();
            // Check if it's 4 AM AND user is idle to prevent interruption
            if (now.getHours() === REFRESH_HOUR && now.getMinutes() === 0) {
                if (isIdleRef.current) {
                    // 새 sw.js를 명시적으로 체크 — 있으면 install→activate→controllerchange 트리거
                    try {
                        const reg = await navigator.serviceWorker?.getRegistration();
                        await reg?.update();
                    } catch (_) { /* 네트워크 일시 오류는 무시, reload는 진행 */ }
                    window.location.reload();
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

    // 네트워크만 끊긴 상태에서는 사람을 부르지 않는다. 저장된 키로 계속 재시도 중임을 알리고,
    // 연결이 돌아오면 스스로 대시보드로 복귀한다.
    if (reconnecting) {
        return (
            <div className="activation-screen">
                <h1 style={{ marginBottom: "12px" }}>📡 네트워크 재연결 중</h1>
                <p style={{ color: "#888", fontSize: "0.95rem", maxWidth: "420px", textAlign: "center" }}>
                    인터넷 연결이 끊겨 키오스크 세션을 받지 못했습니다.<br />
                    연결이 복구되면 <strong>자동으로</strong> 다시 시작합니다.
                </p>
                <div className="spinner" style={{ marginTop: "24px" }} />
                <button
                    onClick={() => {
                        const storedKey = readDeviceKey();
                        if (!storedKey) return;
                        clearSessionRetry();
                        requestKioskSession(storedKey);
                    }}
                    disabled={provisioning}
                    style={{ marginTop: "24px", padding: "10px 24px", background: "#667eea", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", opacity: provisioning ? 0.7 : 1 }}
                >
                    {provisioning ? "연결 중..." : "지금 다시 시도"}
                </button>
                <button
                    onClick={() => { clearSessionRetry(); setReconnecting(false); setNeedsDeviceKey(true); }}
                    style={{ marginTop: "10px", padding: "8px 20px", background: "transparent", color: "#888", border: "1px solid #444", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem" }}
                >
                    기기 등록 키 다시 입력
                </button>
            </div>
        );
    }

    // 이전 키로 세션이 살아난 경우에도 현재 키 재등록 화면을 우선 표시한다.
    if (needsDeviceKey || loginError) {
        return (
            <div className="activation-screen">
                <h1 style={{ marginBottom: "12px" }}>🔧 키오스크 기기 등록</h1>
                <p style={{ color: "#888", fontSize: "0.9rem", maxWidth: "420px", textAlign: "center", marginBottom: loginError ? "12px" : "24px" }}>
                    이 태블릿을 키오스크로 사용하려면 운영진용 기기 등록 키를 한 번만 입력하세요.
                    이후에는 자동으로 로그인됩니다.
                </p>
                {loginError && (
                    <p style={{ color: "#e74c3c", fontSize: "0.9rem", maxWidth: "420px", textAlign: "center", marginBottom: "20px" }}>{loginError}</p>
                )}
                <form onSubmit={handleDeviceKeySubmit} style={{ display: "flex", flexDirection: "column", gap: "10px", width: "300px" }}>
                    <input
                        type="password"
                        placeholder="기기 등록 키"
                        value={deviceKeyInput}
                        onChange={(e) => setDeviceKeyInput(e.target.value)}
                        autoComplete="off"
                        style={{ padding: "10px 14px", borderRadius: "6px", border: "1px solid #444", background: "#1a1a2e", color: "#fff", fontSize: "0.95rem" }}
                        required
                    />
                    <button type="submit" disabled={provisioning} style={{ padding: "10px 24px", background: "#667eea", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", opacity: provisioning ? 0.7 : 1 }}>
                        {provisioning ? "등록 중..." : "등록"}
                    </button>
                </form>
                <button onClick={() => window.location.reload()} style={{ marginTop: "12px", padding: "8px 20px", background: "transparent", color: "#888", border: "1px solid #444", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem" }}>새로고침</button>
            </div>
        );
    }

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
        return (
            <div className="activation-screen">
                <h1 style={{ marginBottom: "20px" }}>🎲 덜지니어스 키오스크</h1>
                <p style={{ color: "#888", fontSize: "1rem" }}>키오스크 세션을 준비하는 중...</p>
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
                <div className="kiosk-header-right">
                    <div style={{ fontSize: "1.3rem", color: "#888", fontFamily: "'Courier New', Consolas, monospace", fontWeight: "600", letterSpacing: "2px" }}>
                        {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    {/* 타이머 버튼 — 시계 옆. 타이머 모달이 열려 있으면 X 버튼과 겹치므로 숨김 */}
                    {!showMurderMysteryTimer && (
                        <button className="header-timer-btn" onClick={() => {
                            setShowMurderMysteryTimer(true);
                            timerActiveRef.current = true;
                        }}>
                            <span style={{ fontSize: '1.6rem' }}>⏱️</span>
                            <span>타이머</span>
                        </button>
                    )}
                </div>
            </header>

            {/* 메인 대시보드 */}
            <div className="kiosk-dashboard">
                {/* 동아리 사이트 QR — 찜하기·내 대여 확인은 개인 폰에서 */}
                <div className="kiosk-qr-card">
                    <img className="kiosk-qr-img" src={siteQr} alt="덜지니어스 대여 사이트 QR" draggable={false} />
                    <div className="kiosk-qr-text">
                        <div className="kiosk-qr-title">📱 웹사이트 바로가기</div>
                        <div className="kiosk-qr-sub">찜하기 · 내 대여 확인은<br />폰으로 QR을 찍어주세요</div>
                        <div className="kiosk-qr-url">{SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')}</div>
                    </div>
                </div>

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
