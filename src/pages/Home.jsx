// src/pages/Home.jsx
// 최종 수정일: 2026.10.04 (💡 대여 튜토리얼 + 가입 직후 안내)
// 설명: 메인 — 오피스아워(운영 중일 때만) · 검색 · 인기 게임 · 놀이터 · 상황별 추천 · 하단 정보
//   색은 강조색 하나(보라) + 무채색. 상황별 추천은 관리자 설정(app_config.recommendations) 그대로.

import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useGameData } from '../contexts/GameDataContext';
import { useAuth } from '../contexts/AuthContext';
import InfoBar from '../components/InfoBar';
import InfoModal from '../components/InfoModal';
import RentalTutorial from '../components/RentalTutorial';
import PoweredByBGG from '../components/PoweredByBGG';
import Header from '../components/Header';
import { sendLog, fetchOfficeStatus, fetchOfficeHoursConfig } from '../api';
import { LINKS } from '../infoData';
import { FUN_ITEMS } from '../fun/funItems';
import { isPaidMember } from '../lib/membership';
import { HomeGameCard, RecommendationDeck } from './home/HomeSections';
import './Home.css';

const DEFAULT_OPEN_COLOR = 'linear-gradient(135deg, #1a5c2a, #27ae60)';
const CLOSING_SOON_COLOR = 'linear-gradient(135deg, #7d3800, #e67e22)';

const Home = () => {
    const { games, trending, config, loading, error, trendingError, refreshGames } = useGameData();
    const { user, profile, roles = [], loading: authLoading } = useAuth();
    const [officeStatus, setOfficeStatus] = useState(null);
    const [officeHoursConfig, setOfficeHoursConfig] = useState(null);
    const [isTutorialOpen, setIsTutorialOpen] = useState(false);
    const [isReportOpen, setIsReportOpen] = useState(false);
    // 가입 직후 1회: /?welcome=1 로 들어오면 💡 버튼 위치를 알려준다
    const [searchParams, setSearchParams] = useSearchParams();
    const [playOpen, setPlayOpen] = useState(() => {
        try { return sessionStorage.getItem('home_play_open') === '1'; } catch { return false; }
    });
    // 놀이터 펼침은 이 탭에서만 기억 — 게임 보고 돌아왔을 때 그대로
    const togglePlay = () => {
        const next = !playOpen;
        setPlayOpen(next);
        try { sessionStorage.setItem('home_play_open', next ? '1' : '0'); } catch { /* 저장 불가 환경 */ }
    };
    const [showCoach, setShowCoach] = useState(false);

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

    // 표시는 한 번 읽고 바로 지운다 — 새로고침·뒤로 가기로 다시 뜨지 않게
    useEffect(() => {
        if (searchParams.get('welcome') !== '1') return;
        setShowCoach(true);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('welcome');
        setSearchParams(nextParams, { replace: true });
    }, [searchParams, setSearchParams]);

    const openTutorial = useCallback(() => {
        setShowCoach(false);
        setIsTutorialOpen(true);
    }, []);
    const openReport = useCallback(() => setIsReportOpen(true), []);

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

    const isPaidUser = isPaidMember(user, profile, roles);
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
                <div className="home-search-row">
                    <Link to="/search" onClick={saveScroll} className="home-search-box">
                        <span aria-hidden="true">🔍</span>
                        <span>어떤 게임을 찾으세요?</span>
                    </Link>
                    <button
                        type="button"
                        className={`home-tutorial-btn${showCoach ? ' is-spotlight' : ''}`}
                        onClick={openTutorial}
                        aria-label="대여 이용법 보기"
                    >
                        <span aria-hidden="true">💡</span>
                        <span className="home-tutorial-label">이용법</span>
                    </button>
                    {showCoach && (
                        <div className="home-coach-bubble" role="status">
                            <strong>가입을 환영해요! 🎉</strong>
                            <span>빌리는 방법이 궁금하면 언제든 여기를 눌러 보세요.</span>
                            <div className="home-coach-actions">
                                <button type="button" onClick={() => setShowCoach(false)}>알겠어요</button>
                                <button type="button" className="is-primary" onClick={openTutorial}>지금 보기</button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="home-browse">
                    <Link to="/search" onClick={saveScroll}>게임 모두 보기{browsableCount ? ` (${browsableCount})` : ''} →</Link>
                    <Link to="/categories" onClick={saveScroll}>카테고리별로 →</Link>
                </div>
            </section>

            {/* 비부원(비로그인·회비 미납): 왼쪽 비회원 단기 대여 · 오른쪽 부원 가입 신청 */}
            {!authLoading && !isPaidUser && (
                <div className="home-entry-pair">
                    <Link to="/org-rental" className="home-org-card">
                        <span>
                            <strong>비회원 단기 대여</strong>
                            <span>동아리·단체 행사에 보드게임이 필요하다면</span>
                        </span>
                        <span aria-hidden="true">→</span>
                    </Link>
                    <a href={LINKS.recruit} target="_blank" rel="noopener noreferrer" className="home-org-card is-join">
                        <span>
                            <strong>덜지니어스 가입</strong>
                            <span>부원은 보드게임 무제한 대여</span>
                        </span>
                        <span aria-hidden="true">→</span>
                    </a>
                </div>
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
                {/* 입구는 하나만 — 누르면 아래로 펼쳐 콘텐츠를 고른다. 늘어도 홈이 번잡해지지 않게 (2026-10-08) */}
                <button type="button" className={`home-play-card home-play-toggle${playOpen ? ' is-open' : ''}`}
                    aria-expanded={playOpen} aria-controls="home-play-menu" onClick={togglePlay}>
                    <span className="home-play-icon" aria-hidden="true">🎡</span>
                    <span className="home-play-body">
                        <span className="home-play-name">놀이터</span>
                        <span className="home-play-sub">{FUN_ITEMS.map((i) => i.name.replace('보드게임 ', '')).join(' · ')}</span>
                    </span>
                    <span className="home-play-go" aria-hidden="true">▾</span>
                </button>
                {playOpen && (
                    <ul id="home-play-menu" className="home-play-menu">
                        {FUN_ITEMS.map((item) => (
                            <li key={item.to}>
                                <Link to={item.to} onClick={saveScroll} className="home-play-item">
                                    <span className="home-play-item-icon" aria-hidden="true">{item.icon}</span>
                                    <span className="home-play-item-body">
                                        <span className="home-play-item-name">{item.name}</span>
                                        <span className="home-play-item-desc">{item.desc}</span>
                                    </span>
                                    <span className="home-play-item-go" aria-hidden="true">→</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {!error && config?.length > 0 && (
                <RecommendationDeck games={games} recs={config} onGameClick={saveScroll} />
            )}

            <footer className="home-footer">
                <button type="button" className="home-guide" onClick={openTutorial}>
                    처음이신가요? 이용 가이드 →
                </button>
                {!loading && !error && <InfoBar games={games} onOpenGuide={openTutorial} />}
                <div className="home-footer-bgg">
                    <PoweredByBGG variant="light" height={22} />
                    <span className="home-footer-bgg-caption">Game data from BoardGameGeek</span>
                </div>
            </footer>

            {showCoach && <div className="home-coach-backdrop" onClick={() => setShowCoach(false)} aria-hidden="true" />}

            <RentalTutorial
                isOpen={isTutorialOpen}
                onClose={() => setIsTutorialOpen(false)}
                onOpenReport={openReport}
            />
            <InfoModal
                isOpen={isReportOpen}
                onClose={() => setIsReportOpen(false)}
                initialTab="report"
            />
        </div>
    );
};

export default Home;
