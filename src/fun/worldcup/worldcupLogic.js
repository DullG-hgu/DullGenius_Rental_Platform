// 이상형 월드컵 대진 계산 — 서버 _fun_wc_apply_picks 와 같은 규칙이어야 한다.
//   candidates: 대진 순서의 자리 배열. 부전승 자리는 null (첫 라운드에만, 한 대결에 최대 하나)
//   1라운드: [0] vs [1], [2] vs [3] … 다음 라운드: 승자끼리 순서대로
//   부전승 대결은 고르지 않고 자동 통과 (picks 에 포함되지 않음)
//   topFirst 는 자리 순번(부전승 포함), picks 는 실제 대결 순번으로 센다

// 웨이트 범위 설정 (BGG 웨이트, 하한 포함·상한 미포함). 서버 _fun_wc_weight_key 와 같은 구간
export const WEIGHT_OPTIONS = [
    { key: 'w1', label: '1.5 미만' },
    { key: 'w2', label: '1.5 ~ 2.0' },
    { key: 'w3', label: '2.0 ~ 2.5' },
    { key: 'w4', label: '2.5 ~ 3.0' },
    { key: 'w5', label: '3.0 이상' },
];
export const ALL_WEIGHTS = WEIGHT_OPTIONS.map((o) => o.key);

// 주소의 weights=w3,w5 → 고른 구간 (전부거나 비었으면 null = 조건 없음)
export const parseWeights = (raw) => {
    const picked = ALL_WEIGHTS.filter((k) => (raw || '').split(',').includes(k));
    return picked.length && picked.length < ALL_WEIGHTS.length ? picked : null;
};

// 결과 표시용: 이어진 구간은 하나로 묶는다 (w3,w4 → 「웨이트 2.0~3.0」, w4,w5 → 「웨이트 2.5 이상」)
const WEIGHT_BOUNDS = [null, 1.5, 2.0, 2.5, 3.0, null];
export const weightLabel = (weights) => {
    const idx = ALL_WEIGHTS.map((k, i) => (weights?.includes(k) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length || idx.length === ALL_WEIGHTS.length) return null;
    const contiguous = idx[idx.length - 1] - idx[0] === idx.length - 1;
    if (!contiguous) return `웨이트 ${idx.map((i) => WEIGHT_OPTIONS[i].label).join(', ')}`;
    const lo = WEIGHT_BOUNDS[idx[0]];
    const hi = WEIGHT_BOUNDS[idx[idx.length - 1] + 1];
    const fmt = (n) => n.toFixed(1);
    if (lo === null) return `웨이트 ${fmt(hi)} 미만`;
    if (hi === null) return `웨이트 ${fmt(lo)} 이상`;
    return `웨이트 ${fmt(lo)}~${fmt(hi)}`;
};

export const ROUND_LABEL = (roundSize) => (roundSize === 2 ? '결승' : `${roundSize}강`);

const isBye = (a, b) => a === null || b === null;

// picks: [{ w: 승자 id, ms, u }] — 지금까지 고른 실제 대결 수만큼
export const getMatchState = (candidates, topFirst, picks) => {
    const byId = new Map(candidates.filter(Boolean).map((c) => [c.id, c]));
    const totalMatches = byId.size - 1;

    let current = candidates.map((c) => (c ? c.id : null));
    let pairIndex = 0;
    let idx = 0;

    while (current.length > 1) {
        const next = [];
        const roundMatches = current.length / 2
            - Array.from({ length: current.length / 2 }, (_, i) => isBye(current[2 * i], current[2 * i + 1])).filter(Boolean).length;
        let matchNo = 0;

        for (let i = 0; i < current.length / 2; i += 1) {
            const a = current[2 * i];
            const b = current[2 * i + 1];
            if (isBye(a, b)) {
                next.push(a ?? b);
                pairIndex += 1;
                continue;
            }
            matchNo += 1;
            if (idx === picks.length) {
                const [top, bottom] = topFirst[pairIndex] ? [a, b] : [b, a];
                return {
                    done: false,
                    index: idx,
                    totalMatches,
                    roundSize: current.length,
                    matchNo,
                    roundMatches,
                    top: byId.get(top),
                    bottom: byId.get(bottom),
                };
            }
            const w = picks[idx].w;
            if (w !== a && w !== b) throw new Error('선택 기록이 대진과 맞지 않습니다.');
            next.push(w);
            pairIndex += 1;
            idx += 1;
        }
        current = next;
    }

    return { done: true, index: idx, totalMatches, champion: byId.get(current[0]) };
};

// 다음 대결 후보 (이미지 미리 받기용). 지금 대결에서 누가 이길지 모르니 두 경우 모두 반환
export const getUpcomingCandidates = (candidates, topFirst, picks) => {
    const now = getMatchState(candidates, topFirst, picks);
    if (now.done) return [];
    const seen = new Set();
    const out = [];
    for (const w of [now.top.id, now.bottom.id]) {
        const after = getMatchState(candidates, topFirst, [...picks, { w }]);
        if (after.done) continue;
        for (const c of [after.top, after.bottom]) {
            if (!seen.has(c.id) && c.id !== now.top.id && c.id !== now.bottom.id) {
                seen.add(c.id);
                out.push(c);
            }
        }
    }
    return out;
};
