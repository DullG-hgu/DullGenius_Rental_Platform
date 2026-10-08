// 내 티어표·모두의 티어 공용 저장소 — 내 티어표·게임 상세 카드·마이페이지가 같은 상태를 본다
// 편집은 화면에 바로 반영하고 0.8초 모아 표 전체를 저장한다 (fun_tier_save). 화면을 떠나면 즉시 저장
import { useEffect, useSyncExternalStore } from 'react';
import { fetchMyTier, fetchTierCommunity, saveMyTier, setTierPublic } from '../../api_fun';
import { EMPTY_MINE, mineFromServer, placeGame, placementsToServer, TIER_SLUG } from './tierData';

const SAVE_DELAY = 800;
const COMMUNITY_TTL = 5 * 60 * 1000;

let state = {
    userId: null,
    status: 'idle', // idle | loading | ready | error
    mine: EMPTY_MINE,
    save: 'saved', // saved | pending | saving | error
};
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const set = (patch) => { state = { ...state, ...patch }; emit(); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

let saveTimer = null;
let dirtyLabels = false;
let inFlight = null;

const doSave = async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!state.userId) return;
    if (inFlight) { await inFlight.catch(() => {}); }
    const userId = state.userId;
    const sent = state.mine;
    const labels = dirtyLabels ? sent.labels : null;
    dirtyLabels = false;
    set({ save: 'saving' });
    inFlight = saveMyTier(TIER_SLUG, placementsToServer(sent), labels, Date.now());
    try {
        const res = await inFlight;
        if (state.userId !== userId) return;
        const server = mineFromServer(res?.mine);
        // 저장하는 사이 더 고쳤으면 화면 상태를 유지하고, 서버만 아는 값(대여 기록 등)만 받는다
        const changedSince = state.mine !== sent;
        set({
            mine: changedSince
                ? { ...state.mine, started: server.started, playedElsewhere: server.playedElsewhere }
                : { ...server, isPublic: state.mine.isPublic },
            save: changedSince ? 'pending' : 'saved',
        });
        if (changedSince) scheduleSave();
        invalidateCommunity();
    } catch {
        if (labels) dirtyLabels = true;
        set({ save: 'error' });
    } finally {
        inFlight = null;
    }
};

const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, SAVE_DELAY);
};

export const flushTierSave = () => { if (saveTimer) doSave(); };
export const retryTierSave = () => doSave();

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushTierSave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushTierSave(); });
}

// 로그인 회원 바뀌면 다시 불러온다. 로그아웃이면 비운다
export const loadMyTier = async (userId, { force = false } = {}) => {
    if (!userId) {
        clearTimeout(saveTimer);
        saveTimer = null;
        set({ userId: null, status: 'idle', mine: EMPTY_MINE, save: 'saved' });
        return;
    }
    if (!force && state.userId === userId && (state.status === 'ready' || state.status === 'loading')) return;
    set({ userId, status: 'loading' });
    try {
        const my = await fetchMyTier(TIER_SLUG);
        if (state.userId !== userId) return;
        set({ status: 'ready', mine: mineFromServer(my), save: 'saved' });
    } catch {
        if (state.userId === userId) set({ status: 'error' });
    }
};

export const placeMyTier = (gameId, tier, index) => {
    if (!state.userId) return;
    set({ mine: placeGame(state.mine, gameId, tier, index), save: 'pending' });
    scheduleSave();
};

export const setMyTierLabels = (labels) => {
    if (!state.userId) return;
    dirtyLabels = true;
    set({ mine: { ...state.mine, labels: labels.map((v) => v.trim()) }, save: 'pending' });
    scheduleSave();
};

export const setMyTierPublic = async (isPublic) => {
    if (!state.userId) return;
    const prev = state.mine.isPublic;
    set({ mine: { ...state.mine, isPublic } });
    try {
        await setTierPublic(TIER_SLUG, isPublic);
    } catch (e) {
        set({ mine: { ...state.mine, isPublic: prev } });
        throw e;
    }
};

// 내 표 훅 — userId 를 주면 그 회원 표를 불러 둔다
export const useMyTier = (userId) => {
    const snap = useSyncExternalStore(subscribe, () => state);
    useEffect(() => { loadMyTier(userId ?? null); }, [userId]);
    return snap;
};

// ── 모두의 티어 (세션 캐시) ─────────────────────
let community = { data: null, at: 0, promise: null, error: null };
const communityListeners = new Set();
const emitCommunity = () => communityListeners.forEach((l) => l());

export const invalidateCommunity = () => { community = { ...community, at: 0 }; };

export const loadCommunity = ({ force = false } = {}) => {
    const fresh = community.data && Date.now() - community.at < COMMUNITY_TTL;
    if (!force && (fresh || community.promise)) return community.promise ?? Promise.resolve(community.data);
    const promise = fetchTierCommunity(TIER_SLUG)
        .then((data) => { community = { data, at: Date.now(), promise: null, error: null }; emitCommunity(); return data; })
        .catch((error) => { community = { ...community, promise: null, error }; emitCommunity(); throw error; });
    community = { ...community, promise };
    return promise;
};

export const useCommunity = () => {
    const snap = useSyncExternalStore(
        (l) => { communityListeners.add(l); return () => communityListeners.delete(l); },
        () => community,
    );
    useEffect(() => { loadCommunity().catch(() => {}); }, []);
    return snap;
};
