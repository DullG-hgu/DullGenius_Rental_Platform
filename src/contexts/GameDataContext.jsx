import React, { createContext, useContext, useState, useEffect } from 'react';
import { fetchGames, fetchTrending, fetchConfig } from '../api';

const GameDataContext = createContext(null);

export const GameProvider = ({ children }) => {
    const [games, setGames] = useState([]);
    const [trending, setTrending] = useState([]);
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const CACHE_DURATION = 1000 * 60 * 5; // 5분

    const loadData = async (forceRefresh = false) => {
        setLoading(true);
        setError(null);

        try {
            // 1. 캐시 확인 (강제 새로고침이 아닐 경우)
            if (!forceRefresh) {
                const cachedGames = localStorage.getItem('games_cache');
                const cachedTrending = localStorage.getItem('trending_cache');
                // config는 자주 안 바뀌므로 캐시 검사 생략 가능하지만 일관성을 위해 체크 가능.
                // 여기서는 App.jsx 로직을 참고하여 구현.

                if (cachedGames) {
                    try {
                        const { data, timestamp } = JSON.parse(cachedGames);
                        if (Date.now() - timestamp < CACHE_DURATION) {
                            setGames(data);

                            // 캐시된 게임 데이터가 있으면 트렌딩도 캐시에서 시도
                            if (cachedTrending) {
                                try {
                                    const tCache = JSON.parse(cachedTrending);
                                    // 트렌딩 데이터 매핑
                                    const mapped = tCache.data.map(t => data.find(g => String(g.id) === String(t.id))).filter(Boolean);
                                    setTrending(mapped);
                                } catch (e) { console.warn("Trending cache parsing failed", e); }
                            }

                            // Config는 별도로 빠르게 로드
                            fetchConfig().then(setConfig).catch(console.error);

                            setLoading(false);
                            // 백그라운드 업데이트 (Stale-while-revalidate 유사)
                            // return; // 일단 리턴하지 않고 API 호출하여 최신화 할지 결정. 
                            // App.jsx의 기존 로직은 캐시 유효하면 API 안 불렀음. 동일하게 유지.
                            return;
                        }
                    } catch (e) {
                        console.warn("Games cache parsing failed, fetching from API", e);
                        // 캐시 파싱 실패 시 무시하고 API 호출 진행
                    }
                }
            }

            // 2. API 호출
            const [gamesData, trendingData, configData] = await Promise.all([
                fetchGames(),
                fetchTrending(),
                fetchConfig()
            ]);

            if (gamesData && !gamesData.error) {
                const validGames = gamesData.filter(g => g.name && g.name.trim() !== "");
                setGames(validGames);
                localStorage.setItem('games_cache', JSON.stringify({
                    data: validGames,
                    timestamp: Date.now()
                }));

                // Trending 매핑
                if (Array.isArray(trendingData)) {
                    const mapped = trendingData.map(t => validGames.find(g => String(g.id) === String(t.id))).filter(Boolean);
                    setTrending(mapped);
                    localStorage.setItem('trending_cache', JSON.stringify({
                        data: trendingData,
                        timestamp: Date.now()
                    }));
                }
            } else {
                throw new Error(gamesData?.message || "Failed to fetch games");
            }

            if (configData) {
                setConfig(configData);
            }

        } catch (e) {
            console.error("데이터 로딩 실패:", e);
            setError(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const refreshGames = () => loadData(true);

    return (
        <GameDataContext.Provider value={{ games, trending, config, loading, error, refreshGames }}>
            {children}
        </GameDataContext.Provider>
    );
};

export const useGameData = () => {
    const context = useContext(GameDataContext);
    if (!context) {
        throw new Error('useGameData must be used within a GameProvider');
    }
    return context;
};
