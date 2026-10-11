import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchGames, fetchGamesByIds, fetchTrending, fetchConfig } from '../api';
import { useAuth } from './AuthContext';
import { subscribeToGameChanges } from '../lib/gamesRealtime';
import { canPatchGames, mergePatchedGames } from '../lib/patchGames';

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
// 키오스크는 자체 목록(useKioskData)과 구독을 따로 갖는다. 거기서도 전역 목록·인기·설정·구독을 또 돌리면
// 변경 한 번에 전체 목록을 두 번 받는다 (2026-10-10). 키오스크 화면에 있는 동안 전역 동기화를 멈춘다.
const isKioskPath = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/kiosk');

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
    const dataScopeRef = useRef(undefined);
    dataScopeRef.current = data.scope;
    const lastRefreshAt = useRef(0);
    const inFlight = useRef(false);
    const [suspended, setSuspended] = useState(isKioskPath);

    // 바뀐 게임 몇 개만 다시 읽어 끼워 넣는다 (Realtime 신호). 접속자 전원이 전체 목록 RPC 를 다시 부르던 것을
    // 게임 단건 RPC 로 줄인다 (2026-10-11). 실패하면 예전처럼 목록만 전체 갱신한다.
    // requestId 는 올리지 않는다 — 다른 게임의 단건 갱신끼리 서로 버리지 않게. 그 사이 전체 갱신이 시작됐으면 그쪽이 더 새것이라 버린다.
    // 같은 게임을 겹쳐 읽으면 마지막에 시작한 요청 것만 쓴다 (늦게 도착한 옛 응답이 덮지 않게)
    const patchSeq = useRef(0);
    const latestPatchById = useRef(new Map());
    const patchGames = useCallback(async (ids) => {
        if (scope === undefined || suspended) return;
        const fullRequest = requestId.current;
        const seq = ++patchSeq.current;
        ids.forEach(id => latestPatchById.current.set(String(id), seq));
        let patched;
        try {
            patched = await fetchGamesByIds(ids);
        } catch {
            if (requestId.current === fullRequest && scopeRef.current === scope) refreshGamesRef.current({ gamesOnly: true });
            return;
        }
        if (requestId.current !== fullRequest || scopeRef.current !== scope) return;
        // 이름이 바뀌면 이름순 자리가 달라진다 — 끼워 넣지 말고 목록을 다시 받는다
        if (patched.some(p => { const g = gamesRef.current.find(x => String(x.id) === String(p.id)); return g && g.name !== p.name; })) {
            refreshGamesRef.current({ gamesOnly: true });
            return;
        }
        const fresh = patched.filter(game => latestPatchById.current.get(String(game.id)) === seq && game.name?.trim());
        if (fresh.length === 0) return;
        setData(previous => {
            if (previous.scope !== scope) return previous;
            const games = mergePatchedGames(previous.games, fresh);
            const findGame = (id) => games.find(game => String(game.id) === String(id));
            return { ...previous, games, trending: previous.trending.map(item => findGame(item.id)).filter(Boolean) };
        });
    }, [scope, suspended]);

    // gamesOnly: 재고·대여 상태만 바뀐 경우(Realtime 신호, 찜·취소 직후). 인기·추천 설정은 대여로 바뀌지 않으므로
    // 다시 받지 않고, 들고 있던 인기 목록을 새 게임 객체로 바꿔 끼운다. 전체 갱신(최초·앱 전환·5분 주기·재연결)은 그대로 3건
    const refreshGames = useCallback(async ({ gamesOnly = false } = {}) => {
        if (scope === undefined || suspended) return;
        // 이미 받은 목록이 없으면(최초·계정 전환 직후) 전부 받는다
        const partial = gamesOnly === true && dataScopeRef.current === scope && gamesRef.current.length > 0;
        const request = ++requestId.current;
        lastRefreshAt.current = Date.now();
        inFlight.current = true;
        setData(previous => previous.scope === scope
            ? { ...previous, loading: previous.games.length === 0 }
            : { ...emptyData, scope });
        const [gamesResult, trendingResult, configResult] = await Promise.allSettled(partial
            ? [fetchGames()]
            : [fetchGames(), fetchTrending(), fetchConfig()]);
        if (request === requestId.current) inFlight.current = false;
        if (request !== requestId.current || scopeRef.current !== scope) return;
        setData(previous => {
            const games = gamesResult.status === 'fulfilled'
                ? gamesResult.value.filter(game => game.name?.trim()) : previous.games;
            const findGame = (id) => games.find(game => String(game.id) === String(id));
            if (partial) {
                return {
                    ...previous, scope, games, loading: false,
                    trending: previous.trending.map(item => findGame(item.id)).filter(Boolean),
                    error: gamesResult.status === 'rejected' ? gamesResult.reason : null,
                };
            }
            const trending = trendingResult.status === 'fulfilled'
                ? trendingResult.value.map(item => findGame(item.id)).filter(Boolean)
                : [];
            return {
                scope, games, trending, loading: false,
                config: configResult.status === 'fulfilled' ? configResult.value : previous.config,
                error: gamesResult.status === 'rejected' ? gamesResult.reason : null,
                trendingError: trendingResult.status === 'rejected' ? trendingResult.reason : null,
                configError: configResult.status === 'rejected' ? configResult.reason : null,
            };
        });
    }, [scope, suspended]);
    const refreshGamesRef = useRef(refreshGames);
    refreshGamesRef.current = refreshGames;

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
        if (scope === undefined || suspended) return;
        // 자동 갱신(앱 전환·주기)은 진행 중이거나 방금 받았으면 건너뛴다. 사람이 누르는 갱신(refreshGames)은 그대로
        const refreshIfStale = () => {
            if (inFlight.current || Date.now() - lastRefreshAt.current < AUTO_REFRESH_MIN_GAP) return;
            refreshGames();
        };
        let reconnectTimer = null;
        const unsubscribe = subscribeToGameChanges({
            channelName: 'games-sync-app',
            onChange: (ids) => {
                // 전체 갱신이 진행 중이면 그 응답이 이 변경 전 상태일 수 있다 — 단건으로 끼우지 않고 새 전체 갱신으로 덮는다
                if (canPatchGames(ids, gamesRef.current) && dataScopeRef.current === scope && !inFlight.current) patchGames(ids);
                else refreshGames({ gamesOnly: true });
            },
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
    }, [scope, suspended, refreshGames, patchGames]);

    const visible = scope !== undefined && data.scope === scope ? data : emptyData;
    return <GameDataContext.Provider value={{ ...visible, refreshGames, setSuspended }}>{children}</GameDataContext.Provider>;
};

// 이 훅을 쓰는 화면이 떠 있는 동안 전역 게임 동기화를 멈춘다 (키오스크). 화면을 벗어나면 다시 받는다
export const useSuspendGameData = () => {
    const context = useContext(GameDataContext);
    const setSuspended = context?.setSuspended;
    useEffect(() => {
        if (!setSuspended) return undefined;
        setSuspended(true);
        return () => setSuspended(false);
    }, [setSuspended]);
};

export const useGameData = () => {
    const context = useContext(GameDataContext);
    if (!context) throw new Error('useGameData must be used within a GameProvider');
    return context;
};
