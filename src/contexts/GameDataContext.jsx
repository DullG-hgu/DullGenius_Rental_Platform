import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchGames, fetchTrending, fetchConfig } from '../api';
import { useAuth } from './AuthContext';
import { subscribeToGameChanges } from '../lib/gamesRealtime';

const GameDataContext = createContext(null);
const REFRESH_INTERVAL = 5 * 60 * 1000;
const emptyData = { games: [], trending: [], config: null, loading: true, error: null, trendingError: null, configError: null };

export const GameProvider = ({ children }) => {
    const { user, loading: authLoading } = useAuth();
    const scope = authLoading ? undefined : (user?.id ?? null);
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    const requestId = useRef(0);
    const [data, setData] = useState({ ...emptyData, scope: undefined });

    const refreshGames = useCallback(async () => {
        if (scope === undefined) return;
        const request = ++requestId.current;
        setData(previous => previous.scope === scope
            ? { ...previous, loading: previous.games.length === 0 }
            : { ...emptyData, scope });
        const [gamesResult, trendingResult, configResult] = await Promise.allSettled([
            fetchGames(), fetchTrending(), fetchConfig()
        ]);
        if (request !== requestId.current || scopeRef.current !== scope) return;
        setData(previous => {
            const games = gamesResult.status === 'fulfilled'
                ? gamesResult.value.filter(game => game.name?.trim()) : previous.games;
            const trending = trendingResult.status === 'fulfilled'
                ? trendingResult.value.map(item => games.find(game => String(game.id) === String(item.id))).filter(Boolean)
                : [];
            return {
                scope, games, trending, loading: false,
                config: configResult.status === 'fulfilled' ? configResult.value : previous.config,
                error: gamesResult.status === 'rejected' ? gamesResult.reason : null,
                trendingError: trendingResult.status === 'rejected' ? trendingResult.reason : null,
                configError: configResult.status === 'rejected' ? configResult.reason : null,
            };
        });
    }, [scope]);

    useEffect(() => {
        // Old persistent caches may contain a previous account's rental information.
        // Keep account-dependent results in memory only, after auth has settled.
        try {
            localStorage.removeItem('games_cache');
            localStorage.removeItem('trending_cache');
            localStorage.removeItem('config_cache');
        } catch { /* Storage can be unavailable in private browsing. */ }
        refreshGames();
        return () => { requestId.current += 1; };
    }, [refreshGames]);

    useEffect(() => {
        if (scope === undefined) return;
        const unsubscribe = subscribeToGameChanges({
            channelName: 'games-sync-app', onChange: refreshGames, onReconnect: refreshGames
        });
        const onVisible = () => { if (document.visibilityState === 'visible') refreshGames(); };
        window.addEventListener('focus', onVisible);
        document.addEventListener('visibilitychange', onVisible);
        const timer = setInterval(onVisible, REFRESH_INTERVAL);
        return () => {
            unsubscribe();
            clearInterval(timer);
            window.removeEventListener('focus', onVisible);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [scope, refreshGames]);

    const visible = scope !== undefined && data.scope === scope ? data : emptyData;
    return <GameDataContext.Provider value={{ ...visible, refreshGames }}>{children}</GameDataContext.Provider>;
};

export const useGameData = () => {
    const context = useContext(GameDataContext);
    if (!context) throw new Error('useGameData must be used within a GameProvider');
    return context;
};
