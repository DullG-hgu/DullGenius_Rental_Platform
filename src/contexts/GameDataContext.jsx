import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchGames, fetchTrending, fetchConfig } from '../api';
import { useAuth } from './AuthContext';
import { subscribeToGameChanges } from '../lib/gamesRealtime';

const GameDataContext = createContext(null);
const REFRESH_INTERVAL = 5 * 60 * 1000;
// 앱 전환(focus·visibilitychange 가 둘 다 옴)·주기 갱신은 이 간격 안에 다시 하지 않는다
const AUTO_REFRESH_MIN_GAP = 30 * 1000;
// Realtime 재연결 때 접속자 전원이 같은 순간 전체 목록을 받지 않게 흩뿌린다 (DB 재시작 직후 몰림)
const RECONNECT_JITTER_MS = 10 * 1000;
// 화면에 영향 있는 칸만 비교 — 조회수(total_views) 같은 변경으로는 전체 목록을 다시 받지 않는다
// (찜→수령처럼 재고 수가 그대로인 전환은 남의 화면에 최대 5분·앱 전환 때까지 늦게 반영된다. 키오스크 구독은 거르지 않음)
const WATCHED_FIELDS = ['available_count', 'quantity', 'is_rentable', 'name', 'image', 'category', 'base_game_id',
    'difficulty', 'min_players', 'max_players', 'playingtime', 'genres', 'tags', 'video_url', 'manual_url',
    'recommendation_text', 'owner'];

// Realtime UPDATE 이벤트가 지금 들고 있는 목록과 다른 내용인지
export const isRelevantGameChange = (payload, games) => {
    const next = payload?.new;
    if (!next || next.id == null) return true;
    const current = games.find((g) => String(g.id) === String(next.id));
    if (!current) return true;
    return WATCHED_FIELDS.some((f) => {
        if (!(f in next)) return false;
        // 화면의 available_count 는 대여 기록으로 다시 계산한 값이라 DB 원값(db_available_count)과 비교한다
        const mine = f === 'available_count' && 'db_available_count' in current ? current.db_available_count : current[f];
        return JSON.stringify(next[f] ?? null) !== JSON.stringify(mine ?? null);
    });
};
const emptyData = { games: [], trending: [], config: null, loading: true, error: null, trendingError: null, configError: null };

export const GameProvider = ({ children }) => {
    const { user, loading: authLoading } = useAuth();
    const scope = authLoading ? undefined : (user?.id ?? null);
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    const requestId = useRef(0);
    const [data, setData] = useState({ ...emptyData, scope: undefined });
    const gamesRef = useRef([]);
    gamesRef.current = data.games;
    const lastRefreshAt = useRef(0);
    const inFlight = useRef(false);

    const refreshGames = useCallback(async () => {
        if (scope === undefined) return;
        const request = ++requestId.current;
        lastRefreshAt.current = Date.now();
        inFlight.current = true;
        setData(previous => previous.scope === scope
            ? { ...previous, loading: previous.games.length === 0 }
            : { ...emptyData, scope });
        const [gamesResult, trendingResult, configResult] = await Promise.allSettled([
            fetchGames(), fetchTrending(), fetchConfig()
        ]);
        if (request === requestId.current) inFlight.current = false;
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
        // 자동 갱신(앱 전환·주기)은 진행 중이거나 방금 받았으면 건너뛴다. 사람이 누르는 갱신(refreshGames)은 그대로
        const refreshIfStale = () => {
            if (inFlight.current || Date.now() - lastRefreshAt.current < AUTO_REFRESH_MIN_GAP) return;
            refreshGames();
        };
        let reconnectTimer = null;
        const unsubscribe = subscribeToGameChanges({
            channelName: 'games-sync-app',
            onChange: refreshGames,
            isRelevant: (payload) => isRelevantGameChange(payload, gamesRef.current),
            onReconnect: () => {
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(refreshGames, Math.random() * RECONNECT_JITTER_MS);
            },
        });
        const onVisible = () => { if (document.visibilityState === 'visible') refreshIfStale(); };
        window.addEventListener('focus', onVisible);
        document.addEventListener('visibilitychange', onVisible);
        const timer = setInterval(onVisible, REFRESH_INTERVAL);
        return () => {
            unsubscribe();
            clearTimeout(reconnectTimer);
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
