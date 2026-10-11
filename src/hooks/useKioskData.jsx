// src/hooks/useKioskData.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchGames, fetchGamesByIds, kioskListUsers } from '../api';
import { subscribeToGameChanges } from '../lib/gamesRealtime';
import { canPatchGames, mergePatchedGames } from '../lib/patchGames';

// 회원 캐시 키 버전.
//
// 구버전('kiosk_users')에는 fetchUsers() 가 내려주던 phone·is_paid·joined_semester 등이
// 평문 JSON 으로 들어 있다. 조회를 kioskListUsers() 로 바꿔도 이미 태블릿에 저장된
// 옛 데이터는 그대로 남으므로, 키를 올리고 구버전을 명시적으로 삭제한다.
const USERS_CACHE_KEY = 'kiosk_users_v2';
const LEGACY_USERS_CACHE_KEY = 'kiosk_users';
const GAMES_CACHE_KEY = 'kiosk_games';

// [SORT] 티츄 우선 정렬 (그 외에는 기존 순서 = 이름순 유지)
const sortGames = (list) => [...list].sort((a, b) => {
    if (a.name === '티츄') return -1;
    if (b.name === '티츄') return 1;
    return 0;
});

const writeCache = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (storageError) {
        console.error("LocalStorage 저장 실패 (용량 부족 가능):", storageError);
    }
};

// includeUsers=false 로 부르면 회원 목록을 아예 받지 않는다.
// 룰렛처럼 게임만 쓰는 화면이 전 회원 이름·학번을 태블릿에 내려받을 이유가 없다.
const useKioskData = ({ includeUsers = true } = {}) => {
    const [games, setGames] = useState([]);
    const gamesRef = useRef(games);
    gamesRef.current = games;
    // 응답 순서 보호: 전체 목록은 마지막에 시작한 것만, 단건은 그 게임을 마지막에 요청한 것만 쓴다.
    // 단건 응답은 그 사이 전체 목록 요청이 시작됐으면 버린다 (전체 쪽이 더 새것)
    const fullSeq = useRef(0);
    const fullInFlight = useRef(0);
    const patchSeq = useRef(0);
    const latestPatchById = useRef(new Map());
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // 게임 목록만 다시 읽는다. 화면 깜빡임이 없도록 loading 은 건드리지 않는다.
    // (Realtime 신호로 수시로 불리는 경로라 조용해야 한다)
    // ids 를 받으면(Realtime 신호) 바뀐 게임만 단건 RPC 로 다시 읽어 끼워 넣는다 (2026-10-11).
    // 대여 모달이 열린 채 다른 기기에서 대여·반납이 이어질 때마다 전체 목록을 받던 것을 줄인다. 실패하면 전체 목록
    const syncGames = useCallback(async (ids) => {
        if (canPatchGames(ids, gamesRef.current) && fullInFlight.current === 0) {
            const startedFull = fullSeq.current;
            const seq = ++patchSeq.current;
            ids.forEach(id => latestPatchById.current.set(String(id), seq));
            try {
                const patched = (await fetchGamesByIds(ids)).filter(g => !g.error);
                if (fullSeq.current !== startedFull) return;
                const renamed = patched.some(p => { const g = gamesRef.current.find(x => String(x.id) === String(p.id)); return g && g.name !== p.name; });
                if (!renamed) {
                    const fresh = patched.filter(g => latestPatchById.current.get(String(g.id)) === seq);
                    if (fresh.length === 0) return;
                    setGames(previous => {
                        const merged = mergePatchedGames(previous, fresh);
                        writeCache(GAMES_CACHE_KEY, merged);
                        return merged;
                    });
                    return;
                }
                // 이름이 바뀌면 정렬(티츄 우선·이름순)이 달라진다 — 아래 전체 목록으로
            } catch (e) {
                console.warn("키오스크 게임 단건 동기화 실패, 전체 목록으로:", e);
            }
        }
        const mySeq = ++fullSeq.current;
        fullInFlight.current += 1;
        try {
            const gamesData = await fetchGames();
            if (mySeq !== fullSeq.current) return;
            const validGames = sortGames((gamesData || []).filter(g => !g.error));
            setGames(validGames);
            writeCache(GAMES_CACHE_KEY, validGames);
        } catch (e) {
            // 조용히 실패한다. 화면에는 직전 목록이 남는다.
            console.warn("키오스크 게임 목록 동기화 실패:", e);
        } finally {
            fullInFlight.current -= 1;
        }
    }, []);

    // 게임 + 회원 전체 동기화. 최초 로드와 네트워크 복구 시에 쓴다.
    const syncAll = useCallback(async () => {
        const mySeq = ++fullSeq.current;
        fullInFlight.current += 1;
        try {
            const [gamesData, usersData] = await Promise.all([
                fetchGames(),
                includeUsers ? kioskListUsers() : Promise.resolve(null)
            ]);
            const validGames = sortGames((gamesData || []).filter(g => !g.error));

            // 더 나중에 시작한 전체 목록 요청이 있으면 게임 목록은 그쪽 것을 쓴다
            if (mySeq === fullSeq.current) {
                setGames(validGames);
                writeCache(GAMES_CACHE_KEY, validGames);
            }
            setError(null);

            if (includeUsers) {
                const validUsers = usersData || [];
                setUsers(validUsers);
                writeCache(USERS_CACHE_KEY, validUsers);
            }
        } catch (e) {
            console.error("Kiosk Data Sync Failed:", e);
            setError(e);
        } finally {
            fullInFlight.current -= 1;
            setLoading(false);
        }
    }, [includeUsers]);

    useEffect(() => {
        // 옛 캐시에 남아 있는 개인정보 제거 (기기에서 1회성으로 정리)
        try {
            localStorage.removeItem(LEGACY_USERS_CACHE_KEY);
        } catch { /* storage 접근 불가 환경은 무시 */ }

        // 1. LocalStorage (Instant Load with error handling)
        try {
            const localGames = localStorage.getItem(GAMES_CACHE_KEY);
            const localUsers = includeUsers ? localStorage.getItem(USERS_CACHE_KEY) : null;

            if (localGames && (localUsers || !includeUsers)) {
                const parsedGames = JSON.parse(localGames);
                const parsedUsers = localUsers ? JSON.parse(localUsers) : [];

                // 데이터 유효성 검증
                if (Array.isArray(parsedGames) && Array.isArray(parsedUsers)) {
                    setGames(parsedGames);
                    if (includeUsers) setUsers(parsedUsers);
                    setLoading(false);
                } else {
                    console.warn("캐시된 데이터가 배열이 아닙니다. 캐시를 삭제합니다.");
                    localStorage.removeItem(GAMES_CACHE_KEY);
                    localStorage.removeItem(USERS_CACHE_KEY);
                }
            }
        } catch (parseError) {
            console.warn("캐시 파싱 실패, 재동기화 진행:", parseError);
            try {
                localStorage.removeItem(GAMES_CACHE_KEY);
                localStorage.removeItem(USERS_CACHE_KEY);
            } catch { /* 무시 */ }
        }

        // 2. Background Sync (Fetch Latest)
        syncAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [syncAll, includeUsers]);

    // [REALTIME] 키오스크는 오피스아워 내내 한 번 켜두고 쓴다. 예전에는 마운트 시점
    // 스냅샷으로 하루를 버텨서, 관리자나 다른 회원이 대여·반납해도 키오스크 화면은
    // 옛 재고를 계속 보여줬다. games 변경 신호로 목록을 따라가게 한다.
    // 네트워크가 끊겼다 붙으면(태블릿 특성상 잦다) 회원 목록까지 한 번 전체 동기화한다.
    useEffect(() => {
        const unsubscribe = subscribeToGameChanges({
            channelName: 'games-sync-kiosk',
            onChange: syncGames,
            onReconnect: syncAll
        });
        return unsubscribe;
    }, [syncGames, syncAll]);

    return { games, users, loading, error, refetch: syncAll };
};

export default useKioskData;
