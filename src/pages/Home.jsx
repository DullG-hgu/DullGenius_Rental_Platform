import React, { useEffect, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameData } from '../contexts/GameDataContext';
import { getOptimizedImageUrl } from '../utils/imageOptimizer';
import InfoBar from '../components/InfoBar';
import InfoModal from '../components/InfoModal';
import PoweredByBGG from '../components/PoweredByBGG';
import Header from '../components/Header'; // [NEW] Header Component
import LazyImage from '../components/common/LazyImage'; // [NEW] Lazy Image
import { sendLog, fetchOfficeStatus, fetchOfficeHoursConfig } from '../api';
import './Home.css'; // [NEW] External CSS

const Home = () => {
    const { games, trending, loading, error, trendingError, refreshGames } = useGameData();
    const [officeStatus, setOfficeStatus] = useState(null);
    const [officeHoursConfig, setOfficeHoursConfig] = useState(null);
    const [isGuideOpen, setIsGuideOpen] = useState(false);

    const [now, setNow] = useState(Date.now);
    const [officeError, setOfficeError] = useState(false);
    const [officeRetry, setOfficeRetry] = useState(0);

    // Office schedules are Korea time even when the visitor's browser is abroad.
    const getCloseTime = () => {
        if (officeStatus?.auto_close_at) return new Date(officeStatus.auto_close_at);
        if (officeHoursConfig?.auto_close_hour != null) {
            const koreaDate = new Date(now + 9 * 60 * 60 * 1000);
            return new Date(Date.UTC(koreaDate.getUTCFullYear(), koreaDate.getUTCMonth(), koreaDate.getUTCDate(),
                Number(officeHoursConfig.auto_close_hour) - 9, Number(officeHoursConfig.auto_close_minute) || 0));
        }
        return null;
    };
    const closeTime = getCloseTime();
    const isOfficeOpen = !officeError && officeStatus?.open &&
        (!officeStatus.auto_close_at || now < new Date(officeStatus.auto_close_at).getTime());
    const msToClose = closeTime ? closeTime.getTime() - now : null;
    const isClosingSoon = isOfficeOpen && msToClose > 0 && msToClose <= 30 * 60 * 1000;
    const closeTimeStr = closeTime && Number.isFinite(closeTime.getTime())
        ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).format(closeTime)
        : '';

    useEffect(() => {
        let active = true;
        let pending = false;
        const refreshOffice = async () => {
            if (pending) return;
            pending = true;
            setNow(Date.now());
            try {
                const [status, config] = await Promise.all([fetchOfficeStatus(), fetchOfficeHoursConfig()]);
                if (!active) return;
                setOfficeStatus(status);
                setOfficeHoursConfig(config);
                setOfficeError(false);
            } catch {
                if (active) setOfficeError(true);
            } finally {
                pending = false;
            }
        };
        const onVisible = () => { if (document.visibilityState === 'visible') refreshOffice(); };
        refreshOffice();
        const poll = setInterval(refreshOffice, 30_000);
        const clock = setInterval(() => setNow(Date.now()), 1000);
        window.addEventListener('focus', refreshOffice);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            active = false;
            clearInterval(poll);
            clearInterval(clock);
            window.removeEventListener('focus', refreshOffice);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [officeRetry]);

    useEffect(() => {
        // 페이지 진입 로그
        if (!loading) {
            sendLog(null, 'VIEW', { value: 'Home Page' });
        }
    }, [loading]);

    // 스크롤 위치 복원 (Home) - 뒤로가기 복원 후 즉시 삭제
    useEffect(() => {
        const savedScrollY = sessionStorage.getItem('home_scroll_y');
        if (savedScrollY) {
            window.scrollTo(0, parseInt(savedScrollY, 10));
            sessionStorage.removeItem('home_scroll_y'); // [FIX] 복원 후 즉시 삭제 (잔류 방지)
        }
    }, []);

    // [OPTIMIZATION] useCallback for handler
    const saveScroll = useCallback(() => {
        sessionStorage.setItem('home_scroll_y', window.scrollY);
    }, []);

    // [PERF] 전체 스피너 제거. 레이아웃은 즉시 렌더하고 트렌딩만 스켈레톤 처리.

    return (
        <div className="home-container">
            {/* [1] 헤더 (로고, 로그인, 입부신청) - [RESTORED] */}
            <Header />

            {/* 처음 방문자용 가이드 진입점 — 모두에게 노출, 비강제 */}
            <button
                type="button"
                onClick={() => setIsGuideOpen(true)}
                className="home-guide-entry"
            >
                <span aria-hidden="true">🆕</span>
                <span>처음이신가요? 이용 가이드</span>
                <span aria-hidden="true" className="home-guide-entry-arrow">→</span>
            </button>

            {officeError && (
                <div className="home-status-message" role="alert">
                    <p>오피스아워 운영 상태를 확인하지 못했습니다.</p>
                    <button type="button" onClick={() => setOfficeRetry(value => value + 1)}>운영 상태 다시 시도</button>
                </div>
            )}

            {/* 운영 예정 시간 안내 (오프라인일 때) */}
            {!officeError && !isOfficeOpen && officeHoursConfig && (
                <div style={{
                    margin: "12px 16px 0",
                    padding: "11px 16px",
                    background: "rgba(100, 120, 160, 0.1)",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    border: "1px solid rgba(100, 120, 160, 0.2)",
                    fontSize: "0.9rem",
                    color: "#555"
                }}>
                    <span style={{ fontSize: "1.1rem" }}>{officeHoursConfig.schedule_icon || '📅'}</span>
                    <span>{officeHoursConfig.schedule_text || officeHoursConfig.offline_text || '현재 오피스아워를 운영하고 있지 않아요'}</span>
                </div>
            )}

            {/* 오피스아워 배너 */}
            {isOfficeOpen && (
                <div style={{
                    margin: "12px 16px 0",
                    padding: "14px 20px",
                    background: isClosingSoon
                        ? "linear-gradient(135deg, #7d3800, #e67e22)"
                        : (officeHoursConfig?.banner_color ?? "linear-gradient(135deg, #1a5c2a, #27ae60)"),
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    color: "white",
                    fontWeight: "bold",
                    fontSize: "1rem",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
                }}>
                    <span style={{ fontSize: "1.4rem" }}>
                        {isClosingSoon ? '⏰' : (officeHoursConfig?.banner_icon ?? '🟢')}
                    </span>
                    <div>
                        <div>
                            {isClosingSoon
                                ? `${closeTimeStr}에 오피스아워가 끝나요!`
                                : (officeHoursConfig?.banner_title ?? '오피스아워 진행 중!')}
                        </div>
                        <div style={{ fontWeight: "normal", fontSize: "0.82rem", opacity: 0.85, marginTop: "2px" }}>
                            {isClosingSoon
                                ? '마감 전에 방문해 주세요'
                                : (officeHoursConfig?.banner_subtitle ?? '지금 방문하시면 게임을 대여할 수 있어요')}
                        </div>
                    </div>
                </div>
            )}

            {/* [2] 메인 내비게이션 (Big Buttons) */}
            <section className="home-nav-section">
                <Link
                    to="/categories" onClick={saveScroll}
                    className="home-nav-btn category">
                    <div className="nav-icon">✨</div>
                    <div className="nav-title">추천 보드게임</div>
                    <div className="nav-desc">카테고리로 찾기</div>
                </Link>

                <Link
                    to="/search" onClick={saveScroll}
                    className="home-nav-btn search">
                    <div className="nav-icon">🔍</div>
                    <div className="nav-title">직접 검색하기</div>
                    <div className="nav-desc">게임명, 필터</div>
                </Link>
            </section>



            {/* [4] 요즘 뜨는 게임 (Horizontal Scroll) */}
            <section className="trending-section">
                <h2 className="section-title" style={{ paddingLeft: "20px" }}>🔥 요즘 뜨는 게임</h2>
                {(error || trendingError) && (
                    <div className="home-status-message" role="alert">
                        <p>{error ? '게임 목록을' : '인기 순위를'} 불러오지 못했습니다.</p>
                        <button type="button" onClick={refreshGames}>게임 목록 다시 시도</button>
                    </div>
                )}
                {!loading && !error && !trendingError && trending.length === 0 && (
                    <p className="home-status-message">최근 7일간 집계된 인기 게임이 없습니다.</p>
                )}
                <div className="trending-list">
                    {loading && trending.length === 0 && (
                        [0, 1, 2, 3, 4].map(i => (
                            <div key={`skel-${i}`} className="trending-item" aria-hidden="true">
                                <div className="trending-skeleton-img" />
                                <div className="trending-skeleton-line" />
                                <div className="trending-skeleton-line short" />
                            </div>
                        ))
                    )}
                    {!error && !trendingError && trending.slice(0, 5).map((game, index) => (
                        <Link
                            key={game.id}
                            to={`/game/${game.id}`}
                            state={{ game, from: '/' }}
                            onClick={saveScroll}
                            className="trending-item"
                        >
                            <div className="trending-img-wrapper">
                                <div className="trending-rank">
                                    {index + 1}위
                                </div>
                                {game.image ? (
                                    <LazyImage
                                        src={getOptimizedImageUrl(game.image, 200)}
                                        fallbackSrc={game.image}
                                        alt={game.name}
                                        className="trending-img"
                                        aspectRatio="1/1"
                                    />
                                ) : (
                                    <div className="trending-img" style={{ background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <span style={{ fontSize: '1.5em' }}>🎲</span>
                                    </div>
                                )}
                            </div>
                            <div className="trending-name">
                                {game.name}
                            </div>
                            <div className="trending-category">{game.category}</div>
                        </Link>
                    ))}

                    {/* [NEW] 더보기 버튼 (순위 확장) */}
                    {!error && !trendingError && trending.length > 5 && (
                        <Link
                            to="/search?type=trending"
                            onClick={saveScroll}
                            className="trending-item more-item"
                        >
                            <div className="trending-img-wrapper more-wrapper">
                                <div className="more-content">
                                    <span className="more-icon">➡️</span>
                                    <span>인기 순위<br />더보기</span>
                                </div>
                            </div>
                        </Link>
                    )}
                </div>
            </section>

            {/* [5] 하단 정보 바 (InfoBar) - [MOVED TO FOOTER] */}
            <footer className="home-footer">
                {!loading && !error && <InfoBar games={games} />}
                <div className="home-footer-bgg">
                    <PoweredByBGG variant="light" height={26} />
                    <span className="home-footer-bgg-caption">Game data from BoardGameGeek</span>
                </div>
            </footer>

            <InfoModal
                isOpen={isGuideOpen}
                onClose={() => setIsGuideOpen(false)}
                initialTab="guide"
            />
        </div>
    );
};

export default Home;
