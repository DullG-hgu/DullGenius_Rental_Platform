import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const DISMISSED_KEY = 'pwa_install_dismissed';

const InstallPromptBanner = () => {
    const { pathname } = useLocation();
    const [show, setShow] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [showIOSGuide, setShowIOSGuide] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    // [PERF] 첫 페인트 경로에서 제외: 브라우저 유휴 시점까지 초기화 대기
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 800));
        const handle = idle(() => setReady(true), { timeout: 2000 });
        return () => {
            if (window.cancelIdleCallback && typeof handle === 'number') {
                window.cancelIdleCallback(handle);
            }
        };
    }, []);

    useEffect(() => {
        if (!ready) return;
        // 이미 설치됨 (standalone 모드)
        if (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) return;
        // 이미 닫은 적 있음
        if (localStorage.getItem(DISMISSED_KEY)) return;

        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        setIsIOS(ios);

        if (ios) {
            setShow(true);
            return;
        }

        // Android / Chrome: beforeinstallprompt 이벤트 대기
        const handler = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setShow(true);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, [ready]);

    // 어드민, 키오스크 페이지에서는 숨김
    if (pathname.startsWith('/admin') || pathname.startsWith('/kiosk')) return null;
    if (!show) return null;

    const handleDismiss = () => {
        localStorage.setItem(DISMISSED_KEY, '1');
        setShow(false);
    };

    const handleInstall = async () => {
        if (isIOS) {
            setShowIOSGuide(prev => !prev);
            return;
        }
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            localStorage.setItem(DISMISSED_KEY, '1');
        }
        setShow(false);
    };

    return (
        <div style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'calc(100% - 32px)',
            maxWidth: '480px',
            background: 'rgba(28, 28, 30, 0.93)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            borderRadius: '14px',
            padding: '11px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            zIndex: 8000,
            boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'white',
        }}>
            <img src="/logo192.png" alt="" style={{ width: '38px', height: '38px', borderRadius: '9px', flexShrink: 0 }} />

            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: '600', fontSize: '0.88rem', lineHeight: 1.3 }}>홈 화면에 추가</div>
                <div style={{ color: '#999', fontSize: '0.75rem', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    바로가기를 만들면 더 빠르게 접속할 수 있어요
                </div>
            </div>

            <button
                onClick={handleInstall}
                style={{
                    background: '#5865F2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '7px 13px',
                    fontSize: '0.82rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    flexShrink: 0,
                }}
            >
                {isIOS ? '방법 보기' : '추가'}
            </button>

            <button
                onClick={handleDismiss}
                style={{
                    background: 'none',
                    border: 'none',
                    color: '#666',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    padding: '4px',
                    lineHeight: 1,
                    flexShrink: 0,
                }}
            >✕</button>

            {/* iOS 안내 팝업 */}
            {showIOSGuide && (
                <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 10px)',
                    left: 0,
                    right: 0,
                    background: 'rgba(28, 28, 30, 0.97)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '14px',
                    padding: '16px',
                    fontSize: '0.83rem',
                    lineHeight: 1.8,
                    color: '#ccc',
                }}>
                    <div style={{ fontWeight: '700', color: 'white', marginBottom: '8px', fontSize: '0.9rem' }}>
                        홈 화면에 추가하는 방법
                    </div>
                    <div>1. Safari 하단 <strong style={{ color: 'white' }}>공유 버튼</strong> (□↑) 탭</div>
                    <div>2. <strong style={{ color: 'white' }}>홈 화면에 추가</strong> 선택</div>
                    <div>3. 오른쪽 상단 <strong style={{ color: 'white' }}>추가</strong> 탭</div>
                    <button
                        onClick={() => { setShowIOSGuide(false); handleDismiss(); }}
                        style={{
                            marginTop: '12px',
                            background: 'none',
                            border: '1px solid #444',
                            color: '#aaa',
                            borderRadius: '8px',
                            padding: '6px 14px',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                        }}
                    >
                        확인했어요
                    </button>
                </div>
            )}
        </div>
    );
};

export default InstallPromptBanner;
