import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchGames, fetchTrending, fetchConfig } from '../api';

const GameDataContext = createContext(null);

// 5분: 상대적으로 자주 바뀌는 games/trending 캐시 TTL
const CACHE_DURATION = 1000 * 60 * 5;
// 30분: 자주 안 바뀌는 app_config 캐시 TTL (관리자 변경 시에도 다음 탭 전환에서 갱신됨)
const CONFIG_CACHE_DURATION = 1000 * 60 * 30;

const readCache = (key, ttl) => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const { data, timestamp } = JSON.parse(raw);
        if (typeof timestamp !== 'number') return null;
        const fresh = Date.now() - timestamp < ttl;
        return { data, fresh };
    } catch (e) {
        console.warn(`[GameData] cache parse failed for ${key}`, e);
        return null;
    }
};

const writeCache = (key, data) => {
    try {
        localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) {
        console.warn(`[GameData] cache write failed for ${key}`, e);
    }
};

const mapTrending = (trendingData, games) => {
    if (!Array.isArray(trendingData)) return [];
    return trendingData
        .map(t => games.find(g => String(g.id) === String(t.id)))
        .filter(Boolean);
};

export const GameProvider = ({ children }) => {
    const [games, setGames] = useState([]);
    const [trending, setTrending] = useState([]);
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    /**
     * [PERF] Stale-While-Revalidate
     * - 캐시가 있으면 즉시 화면에 렌더(loading=false)하고, 백그라운드에서 fresh 데이터로 교체.
     * - 캐시가 없을 때만 네트워크 대기.
     * - forceRefresh=true: 캐시 무시, 즉시 fresh fetch (관리자 화면 등).
     */
    const loadData = useCallback(async (forceRefresh = false) => {
        setError(null);

        let usedCache = false;

        // 1. 캐시 hydrate (forceRefresh 아닐 때만)
        if (!forceRefresh) {
            const gamesCache = readCache('games_cache', CACHE_DURATION);
            const trendingCache = readCache('trending_cache', CACHE_DURATION);
            const configCache = readCache('config_cache', CONFIG_CACHE_DURATION);

            if (gamesCache?.data) {
                setGames(gamesCache.data);
                if (trendingCache?.data) {
                    setTrending(mapTrending(trendingCache.data, gamesCache.data));
                }
                if (configCache?.data) {
                    setConfig(configCache.data);
                }
                // 캐시 hydrate 완료 → 즉시 렌더 해제
                setLoading(false);
                usedCache = true;

                // 캐시가 모두 fresh 하면 네트워크 생략
                const allFresh =
                    gamesCache.fresh &&
                    (!trendingCache || trendingCache.fresh) &&
                    (!configCache || configCache.fresh);
                if (allFresh) return;
            }
        }

        // 2. 네트워크 재검증 (캐시 없음 or stale)
        try {
            const [gamesData, trendingData, configData] = await Promise.all([
                fetchGames(),
                fetchTrending(),
                fetchConfig()
            ]);

            if (gamesData && !gamesData.error) {
                const validGames = gamesData.filter(g => g.name && g.name.trim() !== "");
                setGames(validGames);
                writeCache('games_cache', validGames);

                if (Array.isArray(trendingData)) {
                    setTrending(mapTrending(trendingData, validGames));
                    writeCache('trending_cache', trendingData);
                }
            } else if (!usedCache) {
                // 캐시로 보강 못 했을 때만 에러 표시
                throw new Error(gamesData?.message || "Failed to fetch games");
            }

            if (configData) {
                setConfig(configData);
                writeCache('config_cache', configData);
            }
        } catch (e) {
            console.error("데이터 로딩 실패:", e);
            // 캐시로 이미 렌더 중이면 에러는 조용히(백그라운드 실패 무시)
            if (!usedCache) setError(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const refreshGames = useCallback(() => loadData(true), [loadData]);

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
