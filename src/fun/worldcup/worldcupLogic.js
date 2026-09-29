// 이상형 월드컵 대진 계산 — 서버 fun_wc_finish 와 같은 규칙이어야 한다.
//   1라운드: candidates[0] vs [1], [2] vs [3] …
//   다음 라운드: 승자끼리 순서대로
//   i번째 대결(0부터, 전체 통틀어)에서 topFirst[i] 가 true 면 대진상 앞 후보가 위(top)

export const ROUND_LABEL = (roundSize) => (roundSize === 2 ? '결승' : `${roundSize}강`);

// picks: [{ w: 승자 id, ms }] — 지금까지 고른 대결 수만큼
export const getMatchState = (candidates, topFirst, picks) => {
    const size = candidates.length;
    const totalMatches = size - 1;
    const byId = new Map(candidates.map((c) => [c.id, c]));

    let current = candidates.map((c) => c.id);
    let idx = 0;

    while (current.length > 1) {
        const next = [];
        for (let i = 0; i < current.length / 2; i += 1) {
            const a = current[2 * i];
            const b = current[2 * i + 1];
            if (idx === picks.length) {
                const [top, bottom] = topFirst[idx] ? [a, b] : [b, a];
                return {
                    done: false,
                    index: idx,
                    totalMatches,
                    roundSize: current.length,
                    matchNo: i + 1,
                    roundMatches: current.length / 2,
                    top: byId.get(top),
                    bottom: byId.get(bottom),
                };
            }
            const w = picks[idx].w;
            if (w !== a && w !== b) throw new Error('선택 기록이 대진과 맞지 않습니다.');
            next.push(w);
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
