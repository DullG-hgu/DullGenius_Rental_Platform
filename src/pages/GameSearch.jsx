import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useGameData } from '../contexts/GameDataContext';
import { useGameFilter, normalizePlayerFilter } from '../hooks/useGameFilter';
import FilterBar from '../components/FilterBar';
import { getOptimizedImageUrl } from '../utils/imageOptimizer';
import LazyImage from '../components/common/LazyImage';
import { sendLog } from '../api';
import { translateGenre } from '../constants/genreMap';
import './GameSearch.css';

const GameSearch = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { games, trending, loading, error, trendingError, refreshGames } = useGameData();
    const [queryParams, setQueryParams] = useSearchParams();
    const urlQuery = queryParams.get('query') || '';
    const [inputValue, setInputValue] = useState(urlQuery);
    const composing = useRef(false);
    const [isComposing, setIsComposing] = useState(false);
    const selectedCategory = queryParams.get('category') || '전체';
    const difficultyFilter = queryParams.get('difficulty') || '전체';
    const playerFilter = normalizePlayerFilter(queryParams.get('players') || 'all');
    const onlyAvailable = queryParams.get('available') === 'true';
    const isTrendingMode = queryParams.get('type') === 'trending';
    const [searchTerm, setSearchTerm] = useState(inputValue);

    // 입력값은 즉시 로컬에 반영하고, 한글 조합이 끝난 검색어만 URL에 저장한다.
    // replace로 상세 진입·뒤로가기 복원을 유지하면서 입력별 히스토리는 쌓지 않는다.
    const updateFilter = (key, value, defaultValue) => {
        setQueryParams(current => {
            const next = new URLSearchParams(current);
            if (value === defaultValue) next.delete(key);
            else next.set(key, String(value));
            return next;
        }, { replace: true });
    };
    const handleInputChange = event => {
        const value = event.target.value;
        setInputValue(value);
        if (!composing.current && !event.nativeEvent.isComposing) updateFilter('query', value, '');
    };
    const handleCompositionStart = () => {
        composing.current = true;
        setIsComposing(true);
    };
    const handleCompositionEnd = event => {
        composing.current = false;
        setIsComposing(false);
        setInputValue(event.currentTarget.value);
        updateFilter('query', event.currentTarget.value, '');
    };
    useEffect(() => {
        if (!composing.current) setInputValue(urlQuery);
    }, [urlQuery]);
    const setSelectedCategory = value => updateFilter('category', value, '전체');
    const setDifficultyFilter = value => updateFilter('difficulty', value, '전체');
    const setPlayerFilter = value => updateFilter('players', value, 'all');
    const setOnlyAvailable = value => updateFilter('available', value, false);

    // 필터링 훅 사용
    const baseFilteredGames = useGameFilter(games, {
        searchTerm,
        selectedCategory,
        onlyAvailable,
        difficultyFilter,
        playerFilter
    });

    const filteredGames = isTrendingMode ? trending : baseFilteredGames;

    const categories = ["전체", ...new Set(games.map(g => g.category).filter(Boolean))];

    // 스크롤 복원 (Search Page 독립) - 마운트 1회만 실행
    useEffect(() => {
        const savedScrollY = sessionStorage.getItem('search_scroll_y');
        if (savedScrollY) {
            // [FIX] requestAnimationFrame으로 렌더링 완료 후 복원, 복원 후 즉시 삭제
            requestAnimationFrame(() => {
                window.scrollTo(0, parseInt(savedScrollY, 10));
                sessionStorage.removeItem('search_scroll_y');
            });
        } else {
            window.scrollTo(0, 0);
        }
    }, [isTrendingMode]); // 탭 변경 시에도 상단 이동 처리를 위해 의존성 추가

    // 검색어 디바운스 및 로그
    useEffect(() => {
        if (isComposing) return;
        const timer = setTimeout(() => {
            setSearchTerm(inputValue);
        }, 300);
        return () => clearTimeout(timer);
    }, [inputValue, isComposing]);

    // 필터 변경 로그
    useEffect(() => {
        if (loading || isTrendingMode) return;
        const hasFilter = selectedCategory !== "전체" || difficultyFilter !== "전체" || playerFilter !== "all" || onlyAvailable;
        if (!hasFilter) return;

        const timer = setTimeout(() => {
            sendLog(null, 'FILTER_CHANGE', {
                category: selectedCategory,
                difficulty: difficultyFilter,
                players: playerFilter,
                only_available: onlyAvailable
            });
        }, 1000);
        return () => clearTimeout(timer);
    }, [selectedCategory, difficultyFilter, playerFilter, onlyAvailable, loading, isTrendingMode]);

    // SEARCH 로그 (result_count 포함 — searchTerm 변경 시에만 발화)
    useEffect(() => {
        if (searchTerm.length < 2 || isTrendingMode) return;
        sendLog(null, 'SEARCH', { query: searchTerm, result_count: filteredGames.length });
    }, [searchTerm, isTrendingMode]);


    const resetFilters = useCallback(() => {
        setInputValue('');
        setSearchTerm('');
        setQueryParams(current => {
            const next = new URLSearchParams(current);
            ['query', 'category', 'difficulty', 'players', 'available'].forEach(key => next.delete(key));
            return next;
        }, { replace: true });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [setQueryParams]);

    const handleBack = () => {
        // 검색 페이지에서 뒤로가기는 홈으로 (기획)
        // 스크롤 위치는 sessionStorage에 남아있으므로 유지됨
        navigate('/');
    };

    if (loading) return <div className="loading-container"><div className="spinner"></div></div>;

    if (error || (isTrendingMode && trendingError)) return (
        <div className="search-container" role="alert">
            <p>{isTrendingMode ? '인기 순위를' : '게임 목록을'} 불러오지 못했습니다. 연결 상태를 확인한 후 다시 시도해 주세요.</p>
            <button type="button" onClick={refreshGames}>다시 시도</button>
            <Link to="/">홈으로</Link>
        </div>
    );

    return (
        <div className="search-container">
            {/* 상단 헤더 (뒤로가기 + 검색바/타이틀) */}
            <div className="search-header">
                <button onClick={handleBack} className="back-btn" aria-label="홈으로">←</button>
                <div className="search-input-wrapper">
                    {isTrendingMode ? (
                        <h2 className="trending-search-title">🔥 요즘 뜨는 보드게임 (Top 20)</h2>
                    ) : (
                        <input
                            type="text"
                            className="search-page-input"
                            placeholder="게임 이름 검색..."
                            value={inputValue}
                            onChange={handleInputChange}
                            onCompositionStart={handleCompositionStart}
                            onCompositionEnd={handleCompositionEnd}
                            aria-label="게임 이름 또는 태그 검색"
                        />
                    )}
                </div>
            </div>

            {/* 필터 바 (트렌딩 모드일 때는 숨김) */}
            {!isTrendingMode && (
                <FilterBar
                    inputValue={inputValue} setInputValue={setInputValue}
                    selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
                    difficultyFilter={difficultyFilter} setDifficultyFilter={setDifficultyFilter}
                    playerFilter={playerFilter} setPlayerFilter={setPlayerFilter}
                    onlyAvailable={onlyAvailable} setOnlyAvailable={setOnlyAvailable}
                    categories={categories}
                    onReset={resetFilters}
                    hideSearch={true}
                />
            )}

            <div className="search-status-bar">
                {isTrendingMode ? (
                    <span>인기 순위 <strong>{filteredGames.length}</strong>개의 게임</span>
                ) : (
                    <>
                        <span>총 <strong>{filteredGames.length}</strong>개의 게임</span>
                        <button
                            onClick={() => setOnlyAvailable(!onlyAvailable)}
                            aria-pressed={onlyAvailable}
                            className={`available-filter-chip${onlyAvailable ? ' active' : ''}`}
                        >
                            🟢 대여 가능만
                        </button>
                    </>
                )}
            </div>

            {/* 게임 리스트 */}
            <div className="search-game-list">
                {filteredGames.map((game, idx) => (
                    <div key={game.id} className="game-card-animation" style={{ animationDelay: `${idx < 10 ? idx * 0.05 : 0}s` }}>
                        <Link
                            to={`/game/${game.id}`}
                            state={{ game, from: location.pathname + location.search }}
                            className="game-card-link"
                            onClick={() => sessionStorage.setItem('search_scroll_y', window.scrollY)}
                        >
                            <div className="game-item-card">
                                <div className="game-item-img-wrapper" style={{ position: 'relative' }}>
                                    {isTrendingMode && (
                                        <div className="trending-rank-search">
                                            {idx + 1}위
                                        </div>
                                    )}
                                    {game.image ? (
                                        <LazyImage
                                            src={getOptimizedImageUrl(game.image, 400)}
                                            fallbackSrc={game.image}
                                            alt={game.name}
                                            className="game-item-img"
                                            aspectRatio="1/1"
                                        />
                                    ) : (
                                        <div className="game-item-img" style={{ background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <span style={{ fontSize: '3em' }}>🎲</span>
                                        </div>
                                    )}
                                </div>
                                <div className="game-item-info">
                                    <h3 className="game-item-title">{game.name}</h3>
                                    <div className="game-item-meta">
                                        {game.genres && game.genres.length > 0 && (
                                            <>
                                                {game.genres.slice(0, 2).map(translateGenre).join(', ')}
                                                {game.genres.length > 2 ? ` +${game.genres.length - 2}` : ""}
                                            </>
                                        )}
                                        {game.genres?.length > 0 && (game.min_players || game.playingtime) && " · "}
                                        {game.min_players && game.max_players ? `👥 ${game.min_players}~${game.max_players}인` : ""}
                                        {game.min_players && game.playingtime && " · "}
                                        {game.playingtime ? `⏱️ ${game.playingtime}` : ""}
                                    </div>
                                    <div className="game-item-badges">
                                        {game.status === "대여가능" ? (
                                            <span className="badge-status available">대여가능</span> /* [FIX] Removed count */
                                        ) : (
                                            <span className="badge-status unavailable">{game.status}</span>
                                        )}
                                        {game.difficulty && <span className="badge-difficulty">난이도 {game.difficulty}</span>}
                                    </div>
                                </div>
                            </div>
                        </Link>
                    </div>
                ))}
                {filteredGames.length === 0 && (
                    <div className="no-results">
                        {isTrendingMode ? '최근 7일간 집계된 인기 게임이 없습니다.' : '검색 결과가 없습니다. 😅'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default GameSearch;
