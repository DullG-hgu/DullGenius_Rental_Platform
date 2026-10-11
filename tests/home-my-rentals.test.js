import { describe, expect, it } from 'vitest';
import { formatLeft, summarizeMyRentals } from '../src/pages/home/MyRentalsCard';

const now = new Date('2026-10-12T03:00:00Z');
const at = (ms) => new Date(now.getTime() + ms).toISOString();

describe('summarizeMyRentals', () => {
    it('is null when signed out', () => {
        expect(summarizeMyRentals([], null, now)).toBeNull();
    });
    it('picks the earliest due rental and the earliest live reservation; ignores expired reservations, returned rows and holds', () => {
        const games = [
            { rentals: [{ type: 'RENT', user_id: 'me', due_date: at(5 * 86400000) }, { type: 'RENT', user_id: 'me', due_date: at(86400000) }] },
            { rentals: [{ type: 'DIBS', user_id: 'me', due_date: at(-60000) }, { type: 'DIBS', user_id: 'me', due_date: at(30 * 60000) }] },
            { rentals: [{ type: 'RENT', user_id: 'me', due_date: at(86400000), returned_at: at(-1000) }, { type: 'HOLD', user_id: null }] },
        ];
        const s = summarizeMyRentals(games, 'me', now);
        expect(s).toMatchObject({ rentCount: 2, dibsCount: 1, overdue: false, dibsLeftMs: 30 * 60000 });
        expect(s.dueLabel).toMatch(/D-1|오늘 반납/);
    });
});

describe('formatLeft', () => {
    it.each([[59 * 1000, '1분'], [45 * 60000, '45분'], [60 * 60000, '1시간'], [80 * 60000, '1시간 20분']])('%d ms → %s', (ms, text) => {
        expect(formatLeft(ms)).toBe(text);
    });
});
