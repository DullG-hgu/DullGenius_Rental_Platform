// src/pages/Home.jsx
// 최종 수정일: 2026.09.29 (메인 개편)
// 설명: 메인 — 오피스아워(운영 중일 때만) · 검색 · 인기 게임 · 놀이터 · 상황별 추천 · 하단 정보
//   색은 강조색 하나(보라) + 무채색. 상황별 추천은 관리자 설정(app_config.recommendations) 그대로.

import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameData } from '../contexts/GameDataContext';
import { useAuth } from '../contexts/AuthContext';
import InfoBar from '../components/InfoBar';
import InfoModal from '../components/InfoModal';
import PoweredByBGG from '../components/PoweredByBGG';
import Header from '../components/Header';
import { sendLog, fetchOfficeStatus, fetchOfficeHoursConfig } from '../api';
import { fetchWorldcupRanking } from '../api_fun';
import { LINKS } from '../infoData';
import { HomeGameCard, RecommendationDeck } from './home/HomeSections';
import './Home.css';

const EXEMPT_ROLES = ['admin', 'executive', 'payment_exempt'];
const DEFAULT_OPEN_COLOR = 'linear-gradient(135deg, #1a5c2a, #27ae60)';
const CLOSING_SOON_COLOR = 'linear-gradient(135deg, #7d3800, #e67e22)';

const Home = () => {
    const { games, trending, config, loading, error, trendingError, refreshGames } = useGameData();
    const { user, profile, roles = [], loading: authLoading } = useAuth();
    const [officeStatus, setOfficeStatus] = useState(null);
    const [officeHoursConfig, setOfficeHoursConfig] = useState(null);
    const [isGuideOpen, setIsGuideOpen] = useState(false);
    const [wcTop, setWcTop] = useState(null);

    const [now, setNow] = useState(Date.now);

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
    // 운영 중일 때만 카드를 보여준다. 닫혀 있거나 상태를 못 불러오면 아무것도 표시하지 않는다.
    const isOfficeOpen = officeStatus?.open &&
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
                const [status, officeConfig] = await Promise.all([fetchOfficeStatus(), fetchOfficeHoursConfig()]);
                if (!active) return;
                setOfficeStatus(status);
                setOfficeHoursConfig(officeConfig);
            } catch {
                // 못 불러오면 직전 상태를 유지한다 (처음부터 실패면 카드 없음). 30초 뒤 다시 시도.
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
    }, []);

    // 놀이터 카드의 "지금 1위" (순위 표본이 찬 게임이 있을 때만)
    useEffect(() => {
        let active = true;
        fetchWorldcupRanking('all-boardgames', 'all')
            .then((r) => { if (active) setWcTop(r?.items?.find((i) => i.ranked) ?? null); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!loading) {
            sendLog(null, 'VIEW', { value: 'Home Page' });
        }
    }, [loading]);

    useEffect(() => {
        const savedScrollY = sessionStorage.getItem('home_scroll_y');
        if (savedScrollY) {
            window.scrollTo(0, parseInt(savedScrollY, 10));
            sessionStorage.removeItem('home_scroll_y'); // [FIX] 복원 후 즉시 삭제 (잔류 방지)
        }
    }, []);

    const saveScroll = useCallback(() => {
        sessionStorage.setItem('home_scroll_y', window.scrollY);
    }, []);

    const isPaidUser = user && (profile?.is_paid || roles.some((r) => EXEMPT_ROLES.includes(r)));
    const browsableCount = useMemo(() => games.filter((g) => g.name && g.category !== 'TRPG').length, [games]);
    const officeIcon = isClosingSoon
        ? '⏰'
        : (officeHoursConfig?.banner_icon && officeHoursConfig.banner_icon !== '🟢' ? officeHoursConfig.banner_icon : null);

    return (
        <div className="home-container">
            <Header />

            {isOfficeOpen && (
                <section
                    className="home-office"
                    style={{ background: isClosingSoon ? CLOSING_SOON_COLOR : (officeHoursConfig?.banner_color ?? DEFAULT_OPEN_COLOR) }}
                >
                    {officeIcon
                        ? <span className="home-office-icon" aria-hidden="true">{officeIcon}</span>
                        : <span className="home-office-dot" aria-hidden="true" />}
                    <div>
                        <div className="home-office-title">
                            {isClosingSoon
                                ? `${closeTimeStr}에 오피스아워가 끝나요!`
                                : (officeHoursConfig?.banner_title ?? '오피스아워 진행 중!')}
                        </div>
                        <div className="home-office-sub">
                            {isClosingSoon
                                ? '마감 전에 방문해 주세요'
                                : (officeHoursConfig?.banner_subtitle ?? '지금 방문하시면 게임을 대여할 수 있어요')}
                        </div>
                    </div>
                </section>
            )}

            <section className="home-search">
                <Link to="/search" onClick={saveScroll} className="home-search-box">
                    <span aria-hidden="true">🔍</span>
                    <span>어떤 게임을 찾으세요?</span>
                </Link>
                <div className="home-browse">
                    <Link to="/search" onClick={saveScroll}>게임 모두 보기{browsableCount ? ` (${browsableCount})` : ''} →</Link>
                    <Link to="/categories" onClick={saveScroll}>카테고리별로 →</Link>
                </div>
            </section>

            {/* 비로그인: 비회원 단기 대여를 위로 (로그인하면 하단 정보에만) */}
            {!authLoading && !user && (
                <Link to="/org-rental" className="home-org-card">
                    <span>
                        <strong>비회원 단기 대여</strong>
                        <span>동아리·단체 행사에 보드게임이 필요하다면</span>
                    </span>
                    <span aria-hidden="true">→</span>
                </Link>
            )}

            <section className="home-section">
                <div className="home-section-head">
                    <h2>요즘 뜨는 게임</h2>
                    <Link to="/search?type=trending" onClick={saveScroll}>전체 순위</Link>
                </div>
                {(error || trendingError) && (
                    <div className="home-status-message" role="alert">
                        <p>게임 목록을 불러오지 못했습니다.</p>
                        <button type="button" onClick={refreshGames}>게임 목록 다시 시도</button>
                    </div>
                )}
                {!loading && !error && !trendingError && trending.length === 0 && (
                    <p className="home-status-message">최근 7일간 집계된 인기 게임이 없습니다.</p>
                )}
                <div className="home-rail">
                    {loading && trending.length === 0 && Array.from({ length: 4 }, (_, i) => (
                        <div key={`skel-${i}`} className="home-game is-skeleton" aria-hidden="true" />
                    ))}
                    {!error && !trendingError && trending.slice(0, 8).map((game, index) => (
                        <HomeGameCard key={game.id} game={game} rank={index + 1} onClick={saveScroll} />
                    ))}
                </div>
            </section>

            <section className="home-section">
                <div className="home-section-head">
                    <h2>놀이터</h2>
                </div>
                <Link to="/play/worldcup?theme=all-boardgames" onClick={saveScroll} className="home-play-card">
                    <span className="home-play-icon" aria-hidden="true">🏆</span>
                    <span className="home-play-body">
                        <span className="home-play-name">보드게임 이상형 월드컵</span>
                        <span className="home-play-sub">
                            {wcTop ? `지금 1위 · ${wcTop.name}` : '둘 중 하나! 나의 원픽 보드게임 찾기'}
                        </span>
                    </span>
                    <span className="home-play-go" aria-hidden="true">→</span>
                </Link>
                <Link to="/play/quiz" onClick={saveScroll} className="home-play-card">
                    <span className="home-play-icon" aria-hidden="true">🧭</span>
                    <span className="home-play-body">
                        <span className="home-play-name">보드게임 성향검사</span>
                        <span className="home-play-sub">질문 19개로 찾는 나와 맞는 게임 가족</span>
                    </span>
                    <span className="home-play-go" aria-hidden="true">→</span>
                </Link>
            </section>

            {!error && config?.length > 0 && (
                <RecommendationDeck games={games} recs={config} onGameClick={saveScroll} />
            )}

            {!authLoading && !isPaidUser && (
                <a href={LINKS.recruit} target="_blank" rel="noopener noreferrer" className="home-recruit">
                    <span>
                        <strong>덜지니어스 부원 가입 신청</strong>
                        <span>가입 안내와 신청서를 확인해 보세요</span>
                    </span>
                    <span aria-hidden="true">→</span>
                </a>
            )}

            <footer className="home-footer">
                <button type="button" className="home-guide" onClick={() => setIsGuideOpen(true)}>
                    처음이신가요? 이용 가이드 →
                </button>
                {!loading && !error && <InfoBar games={games} />}
                <div className="home-footer-bgg">
                    <PoweredByBGG variant="light" height={22} />
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
