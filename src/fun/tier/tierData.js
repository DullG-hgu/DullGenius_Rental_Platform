// 티어표 공용 상수·변환 (spec_fun_tier.md)
// 화면 상태: { placements: { gameId: 'S' }, order: { S: [gameId...] }, labels, isPublic, started, playedElsewhere }

export const TIER_SLUG = 'murder';
export const TIERS = ['S', 'A', 'B', 'C', 'D'];
export const MURDER_CATEGORY = '머더미스터리';

// 서버(fun_tier_community)와 같은 값 — 설명 모달·화면 판단용
export const SHRINK_K = 3;
export const SPLIT_SHARE = 0.25;
export const DEFAULT_MIN_SAMPLE = 3;

export const isMurder = (game) => game?.category === MURDER_CATEGORY && !game?.base_game_id;

export const EMPTY_MINE = {
    placements: {}, order: {}, labels: ['', '', '', '', ''], isPublic: false, started: false, playedElsewhere: [],
};

// 서버 fun_tier_my → 화면 상태
export const mineFromServer = (my) => {
    if (!my) return EMPTY_MINE;
    const placements = {};
    const order = Object.fromEntries(TIERS.map((t) => [t, []]));
    (my.placements ?? []).forEach(({ game_id: id, tier }) => {
        placements[String(id)] = tier;
        order[tier]?.push(String(id)); // 서버가 tier·pos 순으로 준다
    });
    return {
        placements,
        order,
        labels: Array.isArray(my.labels) && my.labels.length === 5 ? my.labels : EMPTY_MINE.labels,
        isPublic: !!my.is_public,
        started: !!my.started,
        playedElsewhere: (my.played_elsewhere ?? []).map(String),
    };
};

// 화면 상태 → fun_tier_save 의 p_placements ([{ g, t, p }], 줄 안 순서 = order)
export const placementsToServer = (mine) => {
    const out = [];
    TIERS.forEach((t) => {
        const ids = [...new Set((mine.order?.[t] ?? []).map(String))].filter((id) => mine.placements[id] === t);
        Object.keys(mine.placements).forEach((id) => {
            if (mine.placements[id] === t && !ids.includes(id)) ids.push(id);
        });
        ids.forEach((id, i) => out.push({ g: Number(id), t, p: i }));
    });
    return out;
};

// 게임을 tier 줄의 index 자리에 놓는다 (tier=null 이면 빼기, index 없으면 줄 끝)
export const placeGame = (mine, gameId, tier, index) => {
    const id = String(gameId);
    const order = Object.fromEntries(TIERS.map((t) => [t, (mine.order?.[t] ?? []).map(String).filter((x) => x !== id)]));
    const placements = Object.fromEntries(Object.entries(mine.placements).filter(([k]) => k !== id));
    if (tier) {
        placements[id] = tier;
        const row = order[tier];
        row.splice(index == null ? row.length : Math.max(0, Math.min(index, row.length)), 0, id);
    }
    return { ...mine, placements, order, started: true };
};

// 줄별 게임 목록 — order 순서, order 에 없는 게임은 뒤에, 중복은 한 번만
export const rowsFor = (pool, placements, order) => {
    const byId = new Map(pool.map((g) => [String(g.id), g]));
    return Object.fromEntries(TIERS.map((t) => {
        const ids = [...new Set((order?.[t] ?? []).map(String))].filter((id) => placements[id] === t && byId.has(id));
        const seen = new Set(ids);
        pool.forEach((g) => { const id = String(g.id); if (placements[id] === t && !seen.has(id)) ids.push(id); });
        return [t, ids.map((id) => ({ game: byId.get(id) }))];
    }));
};

// 서버 placements 배열 → { placements, order } (공개 티어표용)
export const placementsFromList = (list) => mineFromServer({ placements: list });
