import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import RouletteModal from '../src/kiosk/RouletteModal';

const data = vi.hoisted(() => ({ games: [] }));
vi.mock('../src/hooks/useKioskData', () => ({ default: () => ({ games: data.games, loading: false }) }));

const game = (id, name, min, max, extra = {}) => ({ id, name, min_players: min, max_players: max, status: '대여가능', category: '보드게임', ...extra });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const spinToEnd = async () => {
    fireEvent.click(screen.getByText('추천받기 START'));
    await act(async () => { vi.advanceTimersByTime(2500); });
};

describe('RouletteModal', () => {
    it('offers 2–8 and the 4/4 split', () => {
        data.games = [game(1, 'A', 2, 8)];
        render(<RouletteModal onClose={() => {}} />);
        for (const n of [2, 3, 4, 5, 6, 7, 8]) expect(screen.getByText(`${n}인`)).toBeTruthy();
        expect(screen.getByText('4/4 (8명)')).toBeTruthy();
    });

    it('4/4 shows two different games side by side with their best player counts', async () => {
        data.games = [
            game(1, '보난자', 3, 7, { bgg_id: '11', numplayers_votes: 791, best_players: [4, 5], recommended_players: [3, 6, 7] }),
            game(2, '라스베가스', 2, 5, { bgg_id: '22', numplayers_votes: 221, best_players: [4], recommended_players: [3, 5] }),
            game(3, '카르타벤추라', 1, 6, { bgg_id: '33', numplayers_votes: 60, best_players: [1], recommended_players: [] }),
        ];
        render(<RouletteModal onClose={() => {}} />);
        fireEvent.click(screen.getByText('4/4 (8명)'));
        expect(screen.getByText('2개의 게임')).toBeTruthy(); // 4인 비추천(1인 베스트)은 후보에서 빠진다
        await spinToEnd();
        expect(screen.getByText('1판')).toBeTruthy();
        expect(screen.getByText('2판')).toBeTruthy();
        expect(screen.getAllByText('보난자')).toHaveLength(1);
        expect(screen.getAllByText('라스베가스')).toHaveLength(1);
        expect(screen.getByText(/베스트 4–5인/)).toBeTruthy();
        expect(screen.getByText(/베스트 4인/)).toBeTruthy();
    });

    it('without the new columns keeps the old uniform in-range draw', () => {
        data.games = [game(1, 'A', 1, 7), game(2, 'B', 2, 3)];
        render(<RouletteModal onClose={() => {}} />);
        fireEvent.click(screen.getByText('4인'));
        expect(screen.getByText('1개의 게임')).toBeTruthy();
    });

    it('re-spinning does not repeat a game until the candidates run out', async () => {
        data.games = [game(1, 'A', 2, 6, { numplayers_votes: 50, best_players: [4], recommended_players: [] }),
            game(2, 'B', 2, 6, { numplayers_votes: 50, best_players: [4], recommended_players: [] })];
        render(<RouletteModal onClose={() => {}} />);
        fireEvent.click(screen.getByText('4인'));
        await spinToEnd();
        const first = screen.getByText(/^(A|B)$/).textContent;
        fireEvent.click(screen.getByText('🔄 다시 돌리기'));
        await act(async () => { vi.advanceTimersByTime(2500); });
        const second = screen.getByText(/^(A|B)$/).textContent;
        expect(second).not.toBe(first);
    });
});

describe('RouletteModal verification follow-ups', () => {
    it('4/4 stays off when the only candidates are the same game listed twice', () => {
        data.games = [
            game(1, '젝스 님트!', 2, 10, { bgg_id: '432', numplayers_votes: 664, best_players: [4], recommended_players: [] }),
            game(2, '젝스님트', 2, 10, { bgg_id: '432', numplayers_votes: 664, best_players: [4], recommended_players: [] }),
        ];
        render(<RouletteModal onClose={() => {}} />);
        fireEvent.click(screen.getByText('4/4 (8명)'));
        expect(screen.getByText('조건에 맞는 게임이 없습니다').closest('button').disabled).toBe(true);
    });
    it('conditions are locked while spinning', async () => {
        data.games = [game(1, 'A', 2, 6, { numplayers_votes: 50, best_players: [4], recommended_players: [] })];
        render(<RouletteModal onClose={() => {}} />);
        fireEvent.click(screen.getByText('4인'));
        fireEvent.click(screen.getByText('추천받기 START'));
        expect(screen.getByText('미포함').disabled).toBe(true);
        expect(screen.getByText('5인').disabled).toBe(true);
        await act(async () => { vi.advanceTimersByTime(2500); });
        expect(screen.getByText('미포함').disabled).toBe(false);
    });
});
