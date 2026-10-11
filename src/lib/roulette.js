// 키오스크 룰렛 추첨 (2026-10-11)
//
// 예전에는 min_players ≤ N ≤ max_players 인 게임을 균등하게 뽑아서, 「1~7인」처럼 범위만 넓은 게임
// (실제로는 1인 베스트이거나 대인원 게임)이 4인 룰렛에 자주 나왔다.
// 이제 BGG 추천 인원(games.best_players / recommended_players / numplayers_votes, bgg_sync.mjs 가 채움)으로
// 가중치를 준다. 우리 min~max 범위는 그대로 먼저 지킨다.
// 근거·수치: database/bgg_sync/2026-10-11_numplayers_report.md

export const PLAYER_OPTIONS = [2, 3, 4, 5, 6, 7, 8];
// 8명이 4명씩 두 판으로 나눌 때 — 4인 기준으로 서로 다른 게임 두 개
export const SPLIT_MODE = '4/4';
export const SPLIT_PLAYERS = 4;

// 투표가 이보다 적으면 판정이 흔들린다 (예: 5표짜리 게임이 5·8인 베스트)
export const RELIABLE_VOTES = 20;
const WEIGHTS = {
    reliable: { best: 4, rec: 1, not: 0 },
    few: { best: 2, rec: 1, not: 0.25 },
};
const NO_DATA_WEIGHT = 0.5;
const NO_DATA_EXACT_WEIGHT = 2; // 정원이 딱 N명인 게임 (머더미스터리 등 BGG 데이터 없는 경우가 많다)

const inRange = (game, n) =>
    game.min_players != null && game.max_players != null && game.min_players <= n && n <= game.max_players;

/** 새 컬럼이 목록에 내려오는지 (DB 적용 전·옛 캐시면 false → 예전처럼 균등 추첨) */
export const hasNumplayersData = (games) => games.some((g) => g && 'numplayers_votes' in g);

/** N명일 때 BGG 판정: 'best' | 'rec' | 'not' | null(데이터 없음) */
export const playerFit = (game, n) => {
    const votes = game.numplayers_votes;
    if (votes == null || votes <= 0) return null;
    if (Array.isArray(game.best_players) && game.best_players.includes(n)) return 'best';
    if (Array.isArray(game.recommended_players) && game.recommended_players.includes(n)) return 'rec';
    return 'not';
};

/** N명일 때 추첨 가중치. 범위 밖이면 0 */
export const gameWeight = (game, n, { useNumplayers = true } = {}) => {
    if (!inRange(game, n)) return 0;
    if (!useNumplayers) return 1;
    const fit = playerFit(game, n);
    if (fit === null) return game.min_players === n && game.max_players === n ? NO_DATA_EXACT_WEIGHT : NO_DATA_WEIGHT;
    return (game.numplayers_votes >= RELIABLE_VOTES ? WEIGHTS.reliable : WEIGHTS.few)[fit];
};

const sameGame = (a, b) =>
    String(a.id) === String(b.id) ||
    (a.bgg_id != null && a.bgg_id !== '' && String(a.bgg_id) === String(b.bgg_id)); // 같은 게임이 두 행인 경우 (젝스 님트)

/**
 * 가중 추첨 한 개. n 이 null(전체)이면 균등.
 * 가중치 합이 0이면(희귀 인원이라 전부 비추천 등) 범위 안 게임 균등으로 대체.
 * @returns 게임 또는 null
 */
export const pickOne = (games, n, { exclude = [], useNumplayers = true, rng = Math.random } = {}) => {
    const pool = games.filter((g) => !exclude.some((x) => sameGame(x, g)));
    if (pool.length === 0) return null;
    if (n == null) return pool[Math.floor(rng() * pool.length)];
    const weights = pool.map((g) => gameWeight(g, n, { useNumplayers }));
    let total = weights.reduce((a, b) => a + b, 0);
    let candidates = pool;
    let w = weights;
    if (total === 0) {
        candidates = pool.filter((g) => inRange(g, n));
        if (candidates.length === 0) return null;
        w = candidates.map(() => 1);
        total = candidates.length;
    }
    let r = rng() * total;
    for (let i = 0; i < candidates.length; i++) {
        r -= w[i];
        if (r < 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
};

/** 이 인원(또는 4/4)으로 나올 수 있는 게임 (가중치 > 0, 없으면 범위 안 전부) */
export const eligibleGames = (games, mode, { useNumplayers = true } = {}) => {
    const n = mode === SPLIT_MODE ? SPLIT_PLAYERS : mode;
    if (n == null) return games;
    const weighted = games.filter((g) => gameWeight(g, n, { useNumplayers }) > 0);
    return weighted.length > 0 ? weighted : games.filter((g) => inRange(g, n));
};

/** 서로 다른 게임 수 (같은 게임이 두 행이면 하나로 — 4/4 는 이게 2 이상이어야 뽑힌다) */
export const countDistinctGames = (games) =>
    games.reduce((acc, g) => (acc.some((x) => sameGame(x, g)) ? acc : [...acc, g]), []).length;

/**
 * 한 번 돌리기. 이미 나온 게임(history)은 다시 뽑지 않고, 후보를 다 쓰면 기록을 비우고 처음부터.
 * mode: null(전체) | 2~8 | SPLIT_MODE
 * @returns {{ picks: Array, history: Array }} picks 는 1개(4/4 면 2개), 못 뽑으면 빈 배열
 */
export const spinRoulette = (games, mode, history = [], { useNumplayers = true, rng = Math.random } = {}) => {
    const count = mode === SPLIT_MODE ? 2 : 1;
    const n = mode === SPLIT_MODE ? SPLIT_PLAYERS : mode;
    // 후보를 먼저 좁힌다 — 좋은 후보를 다 쓴 뒤 남은 비추천 게임이 대체 규칙으로 나오지 않게
    const base = eligibleGames(games, mode, { useNumplayers });
    const draw = (excluded) => {
        const picks = [];
        for (let i = 0; i < count; i++) {
            const pick = pickOne(base, n, { exclude: [...excluded, ...picks], useNumplayers, rng });
            if (!pick) return null;
            picks.push(pick);
        }
        return picks;
    };
    let picks = draw(history);
    let nextHistory = history;
    if (!picks) {
        // 후보 소진 — 기록을 비운다. 방금 나온 게임까지 바로 다시 나오지 않게 직전 결과는 한 번 더 피한다
        const last = history.slice(-count);
        picks = draw(last) ?? draw([]);
        nextHistory = [];
    }
    if (!picks) return { picks: [], history };
    return { picks, history: [...nextHistory, ...picks] };
};

/** 베스트 인원 표시: [4,5] → '4–5인', [4,6] → '4·6인', 없으면 null */
export const formatPlayers = (list) => {
    if (!Array.isArray(list) || list.length === 0) return null;
    const sorted = [...new Set(list)].sort((a, b) => a - b);
    const parts = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (const v of [...sorted.slice(1), null]) {
        if (v !== null && v === prev + 1) { prev = v; continue; }
        parts.push(start === prev ? `${start}` : `${start}–${prev}`);
        start = v;
        prev = v;
    }
    return `${parts.join('·')}인`;
};

// ── 골라 지우기 (2026-10-11) ─────────────────────────────────────────
// 그 인원의 베스트·추천 게임을 룰렛과 같은 가중치로, 서로 다른 게임으로 여러 장 뽑는다.
// 한 장씩 지워 나가 1장(4/4 면 2장)이 남으면 결정.

export const PICK_COUNT = 8;
export const PICK_PLAYER_OPTIONS = [3, 4, 5, 6, 7, 8];

/** 골라 지우기 후보: 범위 안이면서 BGG 베스트·추천인 게임 (새 컬럼이 없으면 범위 안 전부) */
export const pickPool = (games, mode, { useNumplayers = true } = {}) => {
    const n = mode === SPLIT_MODE ? SPLIT_PLAYERS : mode;
    return games.filter((g) => {
        if (!inRange(g, n)) return false;
        if (!useNumplayers) return true;
        const fit = playerFit(g, n);
        return fit === 'best' || fit === 'rec';
    });
};

/**
 * 서로 다른 게임 count 장을 가중치대로(비복원) 뽑는다.
 * avoid(직전 카드)는 가능한 한 빼고, 모자라면 그중에서 채운다.
 */
export const drawCards = (games, mode, { count = PICK_COUNT, avoid = [], useNumplayers = true, rng = Math.random } = {}) => {
    const n = mode === SPLIT_MODE ? SPLIT_PLAYERS : mode;
    const pool = pickPool(games, mode, { useNumplayers });
    const fresh = pool.filter((g) => !avoid.some((x) => sameGame(x, g)));
    const picks = [];
    const drawFrom = (list) => {
        while (picks.length < count) {
            const pick = pickOne(list, n, { exclude: picks, useNumplayers, rng });
            if (!pick) return;
            picks.push(pick);
        }
    };
    drawFrom(fresh);
    drawFrom(pool);
    return picks;
};
