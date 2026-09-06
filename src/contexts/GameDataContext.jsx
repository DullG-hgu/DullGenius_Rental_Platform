import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchGames, fetchTrending, fetchConfig } from '../api';
import { useAuth } from './AuthContext';
import { subscribeToGameChanges } from '../lib/gamesRealtime';

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

// 사용자별로 내용이 달라지는 캐시만 지운다 (config_cache 는 공용, 키오스크 캐시는 별도 키).
// get_games_with_rentals 는 관리자에게만 대여자 정보를 채워주므로, 계정이 바뀌면
// 이전 권한으로 받은 결과가 다음 사용자 화면에 남지 않도록 버린다.
const clearUserScopedCache = () => {
    try {
        localStorage.removeItem('games_cache');
        localStorage.removeItem('trending_cache');
    } catch (e) {
        console.warn('[GameData] cache clear failed', e);
    }
};

const mapTrending = (trendingData, games) => {
    if (!Array.isArray(trendingData)) return [];
    return trendingData
        .map(t => games.find(g => String(g.id) === String(t.id)))
        .filter(Boolean);
};

export const GameProvider = ({ children }) => {
    const { user, loading: authLoading } = useAuth();
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

    // [AUTH] 로그아웃·계정 전환 시 사용자별 캐시를 버리고 현재 권한으로 다시 받는다.
    // 첫 세션 확정(initial session)은 기록만 하고 건너뛴다 — 위의 초기 loadData 가 이미 처리했고,
    // 여기서 또 부르면 콜드 로드마다 SWR 캐시가 무의미해진다.
    const lastAuthUserId = useRef(undefined);
    useEffect(() => {
        if (authLoading) return;
        const currentId = user?.id ?? null;
        if (lastAuthUserId.current === undefined) {
            lastAuthUserId.current = currentId;
            return;
        }
        if (lastAuthUserId.current === currentId) return;
        lastAuthUserId.current = currentId;
        clearUserScopedCache();
        loadData(true);
    }, [user?.id, authLoading, loadData]);

    // [REALTIME] 다른 기기(키오스크·관리자·다른 회원)의 대여·찜·반납을 따라간다.
    // 본인 조작은 각 화면이 refreshGames() 를 직접 불러 즉시 반영하고,
    // 여기는 남의 조작을 데우는 용도다. 둘은 겹쳐도 무해하다(읽기 전용).
    useEffect(() => {
        const unsubscribe = subscribeToGameChanges({
            channelName: 'games-sync-app',
            onChange: refreshGames,
            onReconnect: refreshGames
        });
        return unsubscribe;
    }, [refreshGames]);

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
