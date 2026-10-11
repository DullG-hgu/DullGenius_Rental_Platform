import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { normalizePlayerFilter, useGameFilter } from '../src/hooks/useGameFilter';

afterEach(cleanup);
const game = {
    id: 1, name: '글룸 헤이븐', tags: ['#협력'], renter: '김 철수', owner: null,
    category: '전략', status: '대여가능', difficulty: '3.5', min_players: 2, max_players: 4,
};
const filter = (games, filters) => renderHook(() => useGameFilter(games, filters)).result.current;

describe('combined game filters', () => {
    it.each(['글룸', 'ㄱㄹ', '#협력', '#ㅎㄹ'])('%s does not bypass availability, category, difficulty or players', searchTerm => {
        const games = [game, { ...game, id: 2, status: '대여중' }];
        expect(filter(games, { searchTerm, onlyAvailable: true }).map(g => g.id)).toEqual([1]);
        expect(filter(games, { searchTerm, selectedCategory: '파티' })).toEqual([]);
        expect(filter(games, { searchTerm, difficultyFilter: '입문' })).toEqual([]);
        expect(filter(games, { searchTerm, playerFilter: '6+' })).toEqual([]);
    });

    it.each(['김철수', 'ㄱㅊㅅ'])('renter %s composes with other filters', renterFilter => {
        expect(filter([game], { renterFilter, selectedCategory: '파티' })).toEqual([]);
        expect(filter([game], { renterFilter, ownerFilter: 'someone' })).toEqual([]);
        expect(filter([game], { searchTerm: '다른 게임', renterFilter })).toEqual([]);
        expect(filter([game], { searchTerm: '#협력', renterFilter: '다른 사람' })).toEqual([]);
    });

    it('includes games requiring seven or eight players in six-plus results', () => {
        const games = [game, { ...game, id: 2, min_players: 7, max_players: 8 }, { ...game, id: 3, min_players: 8, max_players: 12 }];
        expect(filter(games, { playerFilter: '6인 이상' }).map(g => g.id)).toEqual([2, 3]);
        expect(filter(games, { playerFilter: '5+' }).map(g => g.id)).toEqual([2, 3]);
    });

    it('excludes games with unknown counts or difficulty when those constraints are selected', () => {
        const unknown = { ...game, min_players: null, max_players: null, difficulty: null };
        expect(filter([unknown], { playerFilter: '3' })).toEqual([]);
        expect(filter([unknown], { difficultyFilter: '전략' })).toEqual([]);
        expect(filter([unknown], {})).toEqual([unknown]);
    });

    it.each([['2인', '2'], ['5인 이상', '5+'], ['6인 이상', '6+'], ['8인 이상', '8+'], ['6+', '6+'], ['invalid', 'all']])('normalizes %s to %s', (value, expected) => {
        expect(normalizePlayerFilter(value)).toBe(expected);
    });
});

describe('overdue filter (rentalDue 기준, 2026-10-11)', () => {
    const rented = { ...game, adminStatus: '대여중' };
    it('keeps only rented games past their due time; unreadable dates are not overdue', () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        const future = new Date(Date.now() + 60 * 60_000).toISOString();
        const games = [
            { ...rented, id: 1, dueDate: past },
            { ...rented, id: 2, dueDate: future },
            { ...rented, id: 3, dueDate: 'not a date' },
            { ...game, id: 4, adminStatus: '대여가능', dueDate: past },
        ];
        expect(filter(games, { onlyOverdue: true }).map(g => g.id)).toEqual([1]);
    });
});
