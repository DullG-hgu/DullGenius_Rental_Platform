// 이상형 월드컵 대진 계산 — 서버 _fun_wc_apply_picks 와 같은 규칙이어야 한다.
//   candidates: 대진 순서의 자리 배열. 부전승 자리는 null (첫 라운드에만, 한 대결에 최대 하나)
//   1라운드: [0] vs [1], [2] vs [3] … 다음 라운드: 승자끼리 순서대로
//   부전승 대결은 고르지 않고 자동 통과 (picks 에 포함되지 않음)
//   topFirst 는 자리 순번(부전승 포함), picks 는 실제 대결 순번으로 센다

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
