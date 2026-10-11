import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PickPlay from '../src/fun/pick/PickPlay';
import { FUN_ITEMS } from '../src/fun/funItems';

const data = vi.hoisted(() => ({}));
vi.mock('../src/contexts/GameDataContext', () => ({ useGameData: () => data }));

const game = (id, extra = {}) => ({
    id, name: `게임${id}`, min_players: 2, max_players: 8, status: '대여가능', category: '보드게임', image: null,
    numplayers_votes: 100, best_players: [4, 5], recommended_players: [3, 6, 7, 8], playingtime: '30분', difficulty: 2.4, ...extra,
});
const removeButtons = () => screen.queryAllByRole('button', { name: /지우기$/ });
const mount = () => render(<MemoryRouter><PickPlay /></MemoryRouter>);

beforeEach(() => { Object.assign(data, { games: [], loading: false, error: null, refreshGames: vi.fn() }); });
afterEach(cleanup);

describe('놀이터 골라 지우기 (/play/pick)', () => {
    it('is listed in the playground', () => {
        expect(FUN_ITEMS.some((i) => i.to === '/play/pick')).toBe(true);
    });

    it('offers 3–7 players and an 8-player 4/4 split (no plain 8)', () => {
        data.games = [game(1)];
        mount();
        for (const n of [3, 4, 5, 6, 7]) expect(screen.getByRole('button', { name: `${n}명` })).toBeTruthy();
        expect(screen.getByRole('button', { name: /8명\s*4\/4로 나누기/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '8명' })).toBeNull();
    });

    it('deals 8 currently available fitting games; tapping a card body does not remove it; ✕ down to one shows the result with a game link', () => {
        data.games = [...Array.from({ length: 10 }, (_, i) => game(i + 1)), game(90, { status: '대여중' }), game(91, { best_players: [1], recommended_players: [] })];
        mount();
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        expect(removeButtons()).toHaveLength(8);
        expect(screen.queryByText('게임90')).toBeNull();
        expect(screen.queryByText('게임91')).toBeNull();
        fireEvent.click(screen.getAllByText(/^게임\d+$/)[0]);
        expect(removeButtons()).toHaveLength(8);
        for (let i = 0; i < 7; i++) fireEvent.click(removeButtons()[0]);
        expect(screen.getByText('결정')).toBeTruthy();
        expect(screen.getByRole('link', { name: '게임 정보 보기' }).getAttribute('href')).toMatch(/^\/game\/\d+$/);
        fireEvent.click(screen.getByRole('button', { name: '되돌리기 (한 장)' }));
        expect(removeButtons()).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: '↻ 처음 8개로' }));
        expect(removeButtons()).toHaveLength(8);
    });

    it('4/4 stops at two and splits them into table A and B', () => {
        data.games = Array.from({ length: 8 }, (_, i) => game(i + 1));
        mount();
        fireEvent.click(screen.getByRole('button', { name: /4\/4로 나누기/ }));
        for (let i = 0; i < 6; i++) fireEvent.click(removeButtons()[0]);
        expect(screen.getByText('테이블 A')).toBeTruthy();
        expect(screen.getByText('테이블 B')).toBeTruthy();
        expect(screen.getAllByRole('link', { name: '게임 정보 보기' })).toHaveLength(2);
    });

    it('a new deal avoids the previous 8 when possible', () => {
        data.games = Array.from({ length: 16 }, (_, i) => game(i + 1));
        mount();
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        const before = removeButtons().map((b) => b.getAttribute('aria-label'));
        fireEvent.click(screen.getByRole('button', { name: '다른 8개 뽑기' }));
        const after = removeButtons().map((b) => b.getAttribute('aria-label'));
        expect(after.filter((a) => before.includes(a))).toHaveLength(0);
    });

    it('says so when fewer than 8 fit, and when none fit', () => {
        data.games = [game(1), game(2), game(3)];
        const view = mount();
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        expect(removeButtons()).toHaveLength(3);
        expect(screen.getByText(/맞는 게임이 3개뿐/)).toBeTruthy();
        view.unmount();
        data.games = [game(1, { min_players: 2, max_players: 4 })];
        mount();
        fireEvent.click(screen.getByRole('button', { name: '7명' }));
        expect(screen.getByText(/7명에 맞는 대여 가능 게임 없음/)).toBeTruthy();
    });

    it('a card rented elsewhere after dealing stays but is marked', () => {
        data.games = [game(1), game(2), game(3)];
        const view = mount();
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        data.games = [game(1, { status: '대여중' }), game(2), game(3)];
        view.rerender(<MemoryRouter><PickPlay /></MemoryRouter>);
        expect(screen.getAllByText('지금 대여 불가')).toHaveLength(1);
    });
});

describe('놀이터 골라 지우기 — verification follow-ups', () => {
    it('back arrow returns to the player choice while playing', () => {
        data.games = Array.from({ length: 8 }, (_, i) => game(i + 1));
        mount();
        fireEvent.click(screen.getByRole('button', { name: '4명' }));
        fireEvent.click(screen.getByRole('button', { name: '인원 다시 고르기' }));
        expect(screen.getByRole('button', { name: '3명' })).toBeTruthy();
        expect(removeButtons()).toHaveLength(0);
    });
    it('shows loading, and an error with retry, only while there is no list yet', () => {
        Object.assign(data, { games: [], loading: true });
        const view = mount();
        expect(screen.getByText('게임 목록 불러오는 중')).toBeTruthy();
        view.unmount();
        Object.assign(data, { games: [], loading: false, error: new Error('offline') });
        mount();
        fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
        expect(data.refreshGames).toHaveBeenCalled();
    });
    it('reset from the decision screen restores all cards', () => {
        data.games = Array.from({ length: 8 }, (_, i) => game(i + 1));
        mount();
        fireEvent.click(screen.getByRole('button', { name: '5명' }));
        for (let i = 0; i < 7; i++) fireEvent.click(removeButtons()[0]);
        fireEvent.click(screen.getByRole('button', { name: '↻ 처음 8개로' }));
        expect(removeButtons()).toHaveLength(8);
    });
});
