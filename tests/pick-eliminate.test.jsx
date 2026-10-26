import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import PickEliminateModal from '../src/kiosk/PickEliminateModal';

const data = vi.hoisted(() => ({ games: [] }));
vi.mock('../src/hooks/useKioskData', () => ({ default: () => ({ games: data.games, loading: false }) }));
afterEach(cleanup);

const game = (id, extra = {}) => ({
    id, name: `게임${id}`, min_players: 2, max_players: 8, status: '대여가능', category: '보드게임',
    numplayers_votes: 100, best_players: [4, 5], recommended_players: [3, 6], playingtime: '30분', difficulty: 2.1, ...extra,
});
const removeButtons = () => screen.queryAllByRole('button', { name: /지우기$/ });

describe('골라 지우기', () => {
    it('offers 3–8 players and the 4/4 split as large choices', () => {
        data.games = [game(1)];
        render(<PickEliminateModal onClose={() => {}} />);
        for (const n of [3, 4, 5, 6, 7]) expect(screen.getByRole('button', { name: `${n}명` })).toBeTruthy();
        expect(screen.getByRole('button', { name: /8명\s*4\/4로 나누기/ })).toBeTruthy();
    });

    it('deals 8 cards with best players, time and difficulty; removing down to one shows the decision; undo and reset work', () => {
        data.games = Array.from({ length: 10 }, (_, i) => game(i + 1));
        render(<PickEliminateModal onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        expect(removeButtons()).toHaveLength(8);
        expect(screen.getAllByText('베스트 4–5인').length).toBe(8);
        expect(screen.getAllByText('난이도 2.1').length).toBe(8);
        for (let i = 0; i < 6; i++) fireEvent.click(removeButtons()[0]);
        expect(screen.getByText(/남은 2개/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '되돌리기 (한 장)' }));
        expect(removeButtons()).toHaveLength(3);
        fireEvent.click(removeButtons()[0]);
        fireEvent.click(removeButtons()[0]);
        expect(screen.getByText('결론')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '↻ 처음 8개로' }));
        expect(removeButtons()).toHaveLength(8);
    });

    it('4/4 stops at two cards and splits them into table A and B', () => {
        data.games = Array.from({ length: 8 }, (_, i) => game(i + 1));
        render(<PickEliminateModal onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /4\/4로 나누기/ }));
        for (let i = 0; i < 6; i++) fireEvent.click(removeButtons()[0]);
        expect(screen.getByText('테이블 A')).toBeTruthy();
        expect(screen.getByText('테이블 B')).toBeTruthy();
        expect(removeButtons()).toHaveLength(0);
    });

    it('a new deal of 8 avoids the previous cards when there are enough', () => {
        data.games = Array.from({ length: 16 }, (_, i) => game(i + 1));
        render(<PickEliminateModal onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        const before = removeButtons().map(b => b.getAttribute('aria-label'));
        fireEvent.click(screen.getByRole('button', { name: '다른 8개 뽑기' }));
        const after = removeButtons().map(b => b.getAttribute('aria-label'));
        expect(after.filter(a => before.includes(a))).toHaveLength(0);
    });

    it('fewer than 8 fitting games: shows what exists and says so; tapping outside does not close', () => {
        const onClose = vi.fn();
        data.games = [game(1), game(2), game(3), game(4, { best_players: [1], recommended_players: [] }), game(5, { status: '대여중' })];
        const { container } = render(<PickEliminateModal onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        expect(removeButtons()).toHaveLength(3);
        expect(screen.getByText(/맞는 게임이 3개뿐/)).toBeTruthy();
        fireEvent.click(container.querySelector('.pe-overlay'));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(within(container.querySelector('.pe-header')).getByRole('button', { name: '닫기' }));
        expect(onClose).toHaveBeenCalled();
    });
});

describe('골라 지우기 verification follow-ups', () => {
    it('undo and reset from the decision screen go back to the cards', () => {
        data.games = Array.from({ length: 8 }, (_, i) => game(i + 1));
        render(<PickEliminateModal onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        for (let i = 0; i < 7; i++) fireEvent.click(removeButtons()[0]);
        expect(screen.getByText('결론')).toBeTruthy();
        expect(screen.getByText('난이도 2.1')).toBeTruthy(); // 결정 카드에도 난이도
        fireEvent.click(screen.getByRole('button', { name: '되돌리기 (한 장)' }));
        expect(removeButtons()).toHaveLength(2);
        for (let i = 0; i < 1; i++) fireEvent.click(removeButtons()[0]);
        fireEvent.click(screen.getByRole('button', { name: '↻ 처음 8개로' }));
        expect(removeButtons()).toHaveLength(8);
    });
    it('reset label follows the real card count', () => {
        data.games = [game(1), game(2), game(3)];
        render(<PickEliminateModal onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        expect(screen.getByRole('button', { name: '↻ 처음 3개로' })).toBeTruthy();
    });
    it('a card rented elsewhere after dealing stays but is marked', () => {
        data.games = [game(1), game(2), game(3)];
        const view = render(<PickEliminateModal onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        data.games = [game(1, { status: '대여중' }), game(2), game(3)];
        view.rerender(<PickEliminateModal onClose={() => {}} />);
        expect(removeButtons()).toHaveLength(3);
        expect(screen.getAllByText('지금 대여 불가')).toHaveLength(1);
    });
});
