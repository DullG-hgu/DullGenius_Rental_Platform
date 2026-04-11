import React, { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useGameData } from '../contexts/GameDataContext';
import { useGameFilter } from '../hooks/useGameFilter';
import FilterBar from '../components/FilterBar';
import { getOptimizedImageUrl } from '../utils/imageOptimizer';
import LazyImage from '../components/common/LazyImage'; // [NEW] Lazy Image
import { sendLog } from '../api';
import './GameSearch.css'; // [NEW] External CSS

const GameSearch = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { games, loading } = useGameData();

    // 쿼리 파라미터 파싱
    const queryParams = new URLSearchParams(location.search);
    const initialQuery = queryParams.get('query') || "";
    const initialCategory = queryParams.get('category') || "전체";
    const initialPlayers = queryParams.get('players') || "all";
    const searchType = queryParams.get('type'); // [NEW] 트렌딩 모드 확인용

    const isTrendingMode = searchType === 'trending';

    // 상태 관리
    const [inputValue, setInputValue] = useState(initialQuery);
    const [searchTerm, setSearchTerm] = useState(initialQuery);
    const [selectedCategory, setSelectedCategory] = useState(initialCategory);
    const [difficultyFilter, setDifficultyFilter] = useState("전체");
    const [playerFilter, setPlayerFilter] = useState(initialPlayers);
    const [onlyAvailable, setOnlyAvailable] = useState(false);

    // 트렌딩 모드일 경우 전역 trending 데이터를 사용, 아닐 경우 필터 훅 결과 사용
    const { trending } = useGameData(); // [NEW] 트렌딩 데이터 가져오기

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
        // ... (생략 없이 원본 유지)
        const timer = setTimeout(() => {
            setSearchTerm(inputValue);
        }, 300);
        return () => clearTimeout(timer);
    }, [inputValue]);

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
        setInputValue("");
        setSearchTerm("");
        setSelectedCategory("전체");
        setDifficultyFilter("전체");
        setPlayerFilter("all");
        setOnlyAvailable(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleBack = () => {
        // 검색 페이지에서 뒤로가기는 홈으로 (기획)
        // 스크롤 위치는 sessionStorage에 남아있으므로 유지됨
        navigate('/');
    };

    if (loading) return <div className="loading-container"><div className="spinner"></div></div>;

    return (
        <div className="search-container">
            {/* 상단 헤더 (뒤로가기 + 검색바/타이틀) */}
            <div className="search-header">
                <button onClick={handleBack} className="back-btn">←</button>
                <div className="search-input-wrapper">
                    {isTrendingMode ? (
                        <h2 className="trending-search-title">🔥 요즘 뜨는 보드게임 (Top 20)</h2>
                    ) : (
                        <input
                            type="text"
                            className="search-page-input"
                            placeholder="게임 이름 검색..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            autoFocus={!initialQuery && !initialCategory}
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
                            onClick={() => setOnlyAvailable(v => !v)}
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
                                        {game.genre}
                                        {game.genre && game.players && " · "}
                                        {game.players ? `👥 ${game.players}` : ""}
                                    </div>
                                    <div className="game-item-badges">
                                        {game.status === "대여가능" ? (
                                            <span className="badge-status available">대여가능</span> /* [FIX] Removed count */
                                        ) : (
                                            <span className="badge-status unavailable">{game.status}</span>
                                        )}
                                        {game.difficulty && <span className="badge-difficulty">🔥 {game.difficulty}</span>}
                                    </div>
                                </div>
                            </div>
                        </Link>
                    </div>
                ))}
                {filteredGames.length === 0 && (
                    <div className="no-results">
                        검색 결과가 없습니다. 😅
                    </div>
                )}
            </div>
        </div>
    );
};

export default GameSearch;
