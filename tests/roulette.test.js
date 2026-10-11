import { describe, expect, it } from 'vitest';
import {
    SPLIT_MODE, drawCards, eligibleGames, formatPlayers, gameWeight, hasNumplayersData, pickOne, pickPool, playerFit, spinRoulette,
} from '../src/lib/roulette';

const g = (id, min, max, extra = {}) => ({ id, name: `G${id}`, min_players: min, max_players: max, ...extra });
// 고정 순서 난수
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

describe('playerFit / gameWeight', () => {
    const party = g(1, 2, 8, { numplayers_votes: 300, best_players: [4, 5], recommended_players: [3, 6] });
    const solo = g(2, 1, 7, { numplayers_votes: 60, best_players: [1], recommended_players: [2] });
    const fewVotes = g(3, 3, 8, { numplayers_votes: 5, best_players: [5, 8], recommended_players: [4] });
    const noData = g(4, 2, 6, { numplayers_votes: null, best_players: null, recommended_players: null });
    const murder = g(5, 4, 4, { numplayers_votes: null });

    it('judges best / rec / not / no data', () => {
        expect(playerFit(party, 4)).toBe('best');
        expect(playerFit(party, 6)).toBe('rec');
        expect(playerFit(party, 8)).toBe('not');
        expect(playerFit(noData, 4)).toBeNull();
        expect(playerFit(g(6, 2, 4, { numplayers_votes: 0, best_players: [], recommended_players: [] }), 3)).toBeNull();
    });
    it('weights: range first, reliable votes strongest, few votes softened, no data low', () => {
        expect(gameWeight(party, 4)).toBe(4);
        expect(gameWeight(party, 6)).toBe(1);
        expect(gameWeight(party, 8)).toBe(0);
        expect(gameWeight(solo, 4)).toBe(0); // 「1~7인」이지만 1인 베스트
        expect(gameWeight(party, 9)).toBe(0); // 범위 밖
        expect(gameWeight(fewVotes, 5)).toBe(2);
        expect(gameWeight(fewVotes, 6)).toBe(0.25);
        expect(gameWeight(noData, 4)).toBe(0.5);
        expect(gameWeight(murder, 4)).toBe(2);
    });
    it('without the new columns every in-range game weighs the same (old behaviour)', () => {
        expect(hasNumplayersData([g(1, 2, 4)])).toBe(false);
        expect(hasNumplayersData([g(1, 2, 4, { numplayers_votes: null })])).toBe(true);
        expect(gameWeight(g(1, 2, 4), 3, { useNumplayers: false })).toBe(1);
    });
});

describe('pickOne', () => {
    it('picks in proportion to weight', () => {
        const best = g(1, 2, 6, { numplayers_votes: 100, best_players: [4], recommended_players: [] });
        const rec = g(2, 2, 6, { numplayers_votes: 100, best_players: [], recommended_players: [4] });
        // 합 5: [0,4) → best, [4,5) → rec
        expect(pickOne([best, rec], 4, { rng: () => 0.79 }).id).toBe(1);
        expect(pickOne([best, rec], 4, { rng: () => 0.81 }).id).toBe(2);
    });
    it('falls back to uniform in-range when every candidate weighs 0', () => {
        const not = g(1, 2, 8, { numplayers_votes: 100, best_players: [4], recommended_players: [] });
        expect(pickOne([not, g(2, 2, 3)], 8, { rng: () => 0 }).id).toBe(1);
        expect(pickOne([g(2, 2, 3)], 8)).toBeNull();
    });
});

describe('spinRoulette', () => {
    const four = [1, 2, 3].map(id => g(id, 2, 6, { numplayers_votes: 50, best_players: [4], recommended_players: [] }));
    const notAt4 = g(9, 1, 7, { numplayers_votes: 50, best_players: [1], recommended_players: [] });
    const pool = [...four, notAt4];

    it('does not repeat until the candidates run out, then starts over without the last pick', () => {
        let history = [];
        const seen = [];
        for (let i = 0; i < 3; i++) {
            const r = spinRoulette(pool, 4, history, { rng: () => 0 });
            seen.push(r.picks[0].id);
            history = r.history;
        }
        expect(new Set(seen).size).toBe(3);
        expect(seen).not.toContain(9); // 4인 비추천은 소진 뒤에도 안 나온다
        const next = spinRoulette(pool, 4, history, { rng: () => 0 });
        expect(next.picks[0].id).not.toBe(seen[2]);
        expect(next.history).toHaveLength(1);
    });
    it('4/4 picks two different games, never the same game listed twice', () => {
        const dupA = g(10, 2, 10, { bgg_id: '432', numplayers_votes: 600, best_players: [4], recommended_players: [] });
        const dupB = g(11, 2, 10, { bgg_id: '432', numplayers_votes: 600, best_players: [4], recommended_players: [] });
        const other = g(12, 2, 6, { bgg_id: '1', numplayers_votes: 600, best_players: [4], recommended_players: [] });
        const r = spinRoulette([dupA, dupB, other], SPLIT_MODE, [], { rng: seq(0, 0, 0) });
        expect(r.picks).toHaveLength(2);
        expect(r.picks.map(p => p.id).sort()).toEqual([10, 12]);
    });
    it('returns no picks when nothing fits', () => {
        expect(spinRoulette([g(1, 2, 3)], 8).picks).toEqual([]);
        expect(spinRoulette([g(1, 2, 4, { numplayers_votes: 9, best_players: [4], recommended_players: [] })], SPLIT_MODE).picks).toEqual([]);
    });
    it('eligible list matches what can come out', () => {
        expect(eligibleGames(pool, 4).map(x => x.id)).toEqual([1, 2, 3]);
        expect(eligibleGames(pool, null)).toHaveLength(4);
    });
});

describe('formatPlayers', () => {
    it.each([[[4, 5], '4–5인'], [[4, 6], '4·6인'], [[6, 7, 8, 4], '4·6–8인'], [[3], '3인'], [[], null], [null, null]])('%j → %s', (list, text) => {
        expect(formatPlayers(list)).toBe(text);
    });
});

describe('verification follow-ups (2026-10-11)', () => {
    const best = g(1, 2, 6, { numplayers_votes: 100, best_players: [4], recommended_players: [] });
    const rec = g(2, 2, 6, { numplayers_votes: 100, best_players: [], recommended_players: [4] });
    it('cumulative boundaries: exactly at the edge goes to the next game, just under 1 to the last', () => {
        expect(pickOne([best, rec], 4, { rng: () => 0 }).id).toBe(1);
        expect(pickOne([best, rec], 4, { rng: () => 0.8 }).id).toBe(2); // r=4 → 첫 구간 [0,4) 밖
        expect(pickOne([best, rec], 4, { rng: () => 0.999999 }).id).toBe(2);
    });
    it('zero-weight games are skipped even at the boundary', () => {
        const not = g(3, 2, 6, { numplayers_votes: 100, best_players: [6], recommended_players: [] });
        expect(pickOne([not, best], 4, { rng: () => 0 }).id).toBe(1);
    });
});

describe('골라 지우기 drawCards', () => {
    const fit = (id, best, rec = [], extra = {}) => g(id, 2, 8, { numplayers_votes: 100, best_players: best, recommended_players: rec, ...extra });
    const many = Array.from({ length: 12 }, (_, i) => fit(i + 1, [4]));
    it('deals distinct best/recommended games only, up to 8', () => {
        const pool = [...many, fit(50, [1]), g(51, 5, 8)];
        const cards = drawCards(pool, 4);
        expect(cards).toHaveLength(8);
        expect(new Set(cards.map(c => c.id)).size).toBe(8);
        expect(cards.some(c => c.id === 50 || c.id === 51)).toBe(false);
    });
    it('a fresh deal avoids the previous cards when possible, then fills from them', () => {
        const first = drawCards(many, 4);
        const second = drawCards(many, 4, { avoid: first });
        const overlap = second.filter(c => first.some(f => f.id === c.id));
        expect(overlap).toHaveLength(4); // 12개 중 새 것 4개 + 직전 것 4개로 채움
        expect(second.filter(c => !first.some(f => f.id === c.id))).toHaveLength(4);
    });
    it('shows only what exists when fewer than 8 fit, and treats duplicate rows as one game', () => {
        const pool = [fit(1, [4], [], { bgg_id: '432' }), fit(2, [4], [], { bgg_id: '432' }), fit(3, [], [4])];
        expect(drawCards(pool, 4)).toHaveLength(2);
        expect(pickPool(pool, SPLIT_MODE)).toHaveLength(3);
    });
    it('without the new columns uses every in-range game', () => {
        expect(drawCards([g(1, 2, 4), g(2, 5, 6)], 4, { useNumplayers: false }).map(c => c.id)).toEqual([1]);
    });
});
