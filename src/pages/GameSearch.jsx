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

    // 쿼리 파라미터 파싱 (생략 가능, hook으로 리팩토링 가능하나 일단 유지)
    const queryParams = new URLSearchParams(location.search);
    const initialQuery = queryParams.get('query') || "";
    const initialCategory = queryParams.get('category') || "전체";
    const initialPlayers = queryParams.get('players') || "all";

    // 상태 관리
    const [inputValue, setInputValue] = useState(initialQuery);
    const [searchTerm, setSearchTerm] = useState(initialQuery);
    const [selectedCategory, setSelectedCategory] = useState(initialCategory);
    const [difficultyFilter, setDifficultyFilter] = useState("전체");
    const [playerFilter, setPlayerFilter] = useState(initialPlayers);
    const [onlyAvailable, setOnlyAvailable] = useState(false);

    // 필터링 훅 사용
    const filteredGames = useGameFilter(games, {
        searchTerm,
        selectedCategory,
        onlyAvailable,
        difficultyFilter,
        playerFilter
    });

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
    }, []); // [FIX] loading 의존성 제거 → loading 변화 시마다 최상단으로 튀는 현상 방지

    // 검색어 디바운스 및 로그
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearchTerm(inputValue);
            if (inputValue.trim()) {
                sendLog(null, 'SEARCH', { query: inputValue.trim() });
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [inputValue]);

    // 필터 변경 로그
    useEffect(() => {
        if (loading) return;
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
    }, [selectedCategory, difficultyFilter, playerFilter, onlyAvailable, loading]);

    // 검색 결과 없음 로그
    useEffect(() => {
        if (searchTerm && filteredGames.length === 0 && !loading) {
            sendLog(null, 'SEARCH_EMPTY', { query: searchTerm });
        }
    }, [searchTerm, filteredGames.length, loading]);


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
            {/* 상단 헤더 (뒤로가기 + 검색바) */}
            <div className="search-header">
                <button onClick={handleBack} className="back-btn">←</button>
                <div className="search-input-wrapper">
                    <input
                        type="text"
                        className="search-page-input"
                        placeholder="게임 이름 검색..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        autoFocus={!initialQuery && !initialCategory}
                    />
                </div>
            </div>

            {/* 필터 바 */}
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

            <div className="search-status-bar">
                총 <strong>{filteredGames.length}</strong>개의 게임
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
                                <div className="game-item-img-wrapper">
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
