import React, { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameData } from '../contexts/GameDataContext';
import { getOptimizedImageUrl } from '../utils/imageOptimizer';
import InfoBar from '../components/InfoBar';
import Header from '../components/Header'; // [NEW] Header Component
import LazyImage from '../components/common/LazyImage'; // [NEW] Lazy Image
import { sendLog, fetchOfficeStatus, fetchOfficeHoursConfig } from '../api';
import './Home.css'; // [NEW] External CSS

const Home = () => {
    const navigate = useNavigate();
    const { games, trending, loading } = useGameData();
    const [officeStatus, setOfficeStatus] = useState(null);
    const [officeHoursConfig, setOfficeHoursConfig] = useState(null);

    // 오피스아워 운영 여부
    const isOfficeOpen = officeStatus?.open &&
        (!officeStatus.auto_close_at || new Date() < new Date(officeStatus.auto_close_at));

    // 마감 30분 전 여부 계산
    const getCloseTime = () => {
        if (officeStatus?.auto_close_at) return new Date(officeStatus.auto_close_at);
        if (officeHoursConfig?.auto_close_hour != null) {
            const d = new Date();
            d.setHours(officeHoursConfig.auto_close_hour, officeHoursConfig.auto_close_minute || 0, 0, 0);
            return d;
        }
        return null;
    };
    const closeTime = getCloseTime();
    const msToClose = closeTime ? closeTime - new Date() : null;
    const isClosingSoon = isOfficeOpen && msToClose != null && msToClose > 0 && msToClose <= 30 * 60 * 1000;
    const closeTimeStr = closeTime
        ? `${closeTime.getHours()}시${closeTime.getMinutes() > 0 ? ` ${closeTime.getMinutes()}분` : ''}`
        : '';

    useEffect(() => {
        Promise.all([fetchOfficeStatus(), fetchOfficeHoursConfig()])
            .then(([status, config]) => {
                setOfficeStatus(status);
                setOfficeHoursConfig(config);
            })
            .catch(() => {});
    }, []);

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
    const handleNavigation = useCallback((path) => {
        sessionStorage.setItem('home_scroll_y', window.scrollY);
        navigate(path);
    }, [navigate]);

    if (loading) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <p style={{ marginTop: "20px", color: "#666" }}>보드게임 정보를 불러오고 있어요...</p>
        </div>
    );

    return (
        <div className="home-container">
            {/* [1] 헤더 (로고, 로그인, 입부신청) - [RESTORED] */}
            <Header />

            {/* 운영 예정 시간 안내 (오프라인일 때) */}
            {!isOfficeOpen && officeHoursConfig && (
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
                <div
                    onClick={() => handleNavigation('/categories')}
                    className="home-nav-btn category">
                    <div className="nav-icon">✨</div>
                    <div className="nav-title">추천 보드게임</div>
                    <div className="nav-desc">카테고리로 찾기</div>
                </div>

                <div
                    onClick={() => handleNavigation('/search')}
                    className="home-nav-btn search">
                    <div className="nav-icon">🔍</div>
                    <div className="nav-title">직접 검색하기</div>
                    <div className="nav-desc">게임명, 필터</div>
                </div>
            </section>



            {/* [4] 요즘 뜨는 게임 (Horizontal Scroll) */}
            <section className="trending-section">
                <h2 className="section-title" style={{ paddingLeft: "20px" }}>🔥 요즘 뜨는 게임</h2>
                <div className="trending-list">
                    {trending.slice(0, 5).map((game, index) => (
                        <div
                            key={game.id}
                            onClick={() => {
                                sessionStorage.setItem('home_scroll_y', window.scrollY);
                                navigate(`/game/${game.id}`, { state: { game, from: '/' } });
                            }}
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
                        </div>
                    ))}

                    {/* [NEW] 더보기 버튼 (순위 확장) */}
                    {trending.length > 5 && (
                        <div
                            onClick={() => {
                                sessionStorage.setItem('home_scroll_y', window.scrollY);
                                navigate('/search?type=trending');
                            }}
                            className="trending-item more-item"
                        >
                            <div className="trending-img-wrapper more-wrapper">
                                <div className="more-content">
                                    <span className="more-icon">➡️</span>
                                    <span>인기 순위<br />더보기</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* [5] 하단 정보 바 (InfoBar) - [MOVED TO FOOTER] */}
            <footer className="home-footer">
                <InfoBar games={games} />
            </footer>
        </div>
    );
};

export default Home;
