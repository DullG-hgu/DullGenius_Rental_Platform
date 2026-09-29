import { describe, expect, it } from 'vitest';
import { getMatchState, getUpcomingCandidates, ROUND_LABEL } from '../src/fun/worldcup/worldcupLogic';

// 2026-09-29 운영 DB 검증 판 그대로 — fun_wc_finish 가 기록한 top/bottom 과 일치해야 한다
const ids = [128, 81, 56, 6, 263, 94, 83, 2];
const candidates = ids.map((id) => ({ id, name: `g${id}` }));
const topFirst = [true, false, false, true, true, true, false];
const winners = [81, 56, 263, 2, 81, 263, 263];
const serverRows = [
    // [round_size, match_no, top, bottom]
    [8, 1, 128, 81],
    [8, 2, 6, 56],
    [8, 3, 94, 263],
    [8, 4, 83, 2],
    [4, 1, 81, 56],
    [4, 2, 263, 2],
    [2, 1, 263, 81],
];

describe('worldcup bracket logic', () => {
    it('서버가 기록한 대결 순서·위아래 배치와 일치한다', () => {
        serverRows.forEach(([roundSize, matchNo, top, bottom], i) => {
            const picks = winners.slice(0, i).map((w) => ({ w }));
            const s = getMatchState(candidates, topFirst, picks);
            expect(s.done).toBe(false);
            expect(s.index).toBe(i);
            expect(s.roundSize).toBe(roundSize);
            expect(s.matchNo).toBe(matchNo);
            expect(s.top.id).toBe(top);
            expect(s.bottom.id).toBe(bottom);
        });
    });

    it('모든 대결을 고르면 우승이 나온다', () => {
        const s = getMatchState(candidates, topFirst, winners.map((w) => ({ w })));
        expect(s.done).toBe(true);
        expect(s.champion.id).toBe(263);
        expect(s.totalMatches).toBe(7);
    });

    it('대진에 없는 승자는 거부한다', () => {
        expect(() => getMatchState(candidates, topFirst, [{ w: 999 }])).toThrow();
    });

    it('다음 대결 후보를 미리 알려준다 (현재 대결 후보 제외)', () => {
        // 8강 1경기 중: 다음은 8강 2경기(6, 56)
        const next = getUpcomingCandidates(candidates, topFirst, []).map((c) => c.id).sort((x, y) => x - y);
        expect(next).toEqual([6, 56]);
        // 8강 마지막 경기 중: 다음은 4강 1경기 — 81 vs 56 (둘 다 현재 대결 밖)
        const last = getUpcomingCandidates(candidates, topFirst, winners.slice(0, 3).map((w) => ({ w })));
        expect(last.map((c) => c.id).sort((x, y) => x - y)).toEqual([56, 81]);
    });

    it('부전승 자리는 고르지 않고 통과하며, 위아래 배치는 자리 순번으로 센다', () => {
        // 8자리 · 참가 5 · 부전승 3: [1,_][2,3][4,_][5,_]
        const slots = [1, null, 2, 3, 4, null, 5, null].map((id) => (id === null ? null : { id }));
        const tf = [true, false, true, true, true, false, true];
        const s0 = getMatchState(slots, tf, []);
        expect(s0.totalMatches).toBe(4);
        expect(s0.roundSize).toBe(8);
        expect(s0.roundMatches).toBe(1);
        expect(s0.matchNo).toBe(1);
        // 실제 첫 대결은 자리 순번 1 → tf[1]=false → 뒤 후보(3)가 위
        expect([s0.top.id, s0.bottom.id]).toEqual([3, 2]);

        // 4강: [1, 2] vs … 자리 순번 4 → tf[4]=true → 1 이 위
        const s1 = getMatchState(slots, tf, [{ w: 2 }]);
        expect(s1.roundSize).toBe(4);
        expect(s1.matchNo).toBe(1);
        expect(s1.roundMatches).toBe(2);
        expect([s1.top.id, s1.bottom.id]).toEqual([1, 2]);

        // 4강 2경기: 4 vs 5, 자리 순번 5 → tf[5]=false → 5 가 위
        const s2 = getMatchState(slots, tf, [{ w: 2 }, { w: 1 }]);
        expect([s2.top.id, s2.bottom.id]).toEqual([5, 4]);

        const end = getMatchState(slots, tf, [{ w: 2 }, { w: 1 }, { w: 4 }, { w: 4 }]);
        expect(end.done).toBe(true);
        expect(end.champion.id).toBe(4);
    });

    it('라운드 이름', () => {
        expect(ROUND_LABEL(16)).toBe('16강');
        expect(ROUND_LABEL(2)).toBe('결승');
    });
});
