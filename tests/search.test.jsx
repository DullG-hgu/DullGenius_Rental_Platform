import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import GameSearch from '../src/pages/GameSearch';
import CategorySelect from '../src/pages/CategorySelect';

const { data, sendLog } = vi.hoisted(() => ({ data: {}, sendLog: vi.fn() }));
vi.mock('../src/contexts/GameDataContext', () => ({ useGameData: () => data }));
vi.mock('../src/api', () => ({ sendLog }));
const game = { id: 1, name: '카탄', category: '전략', min_players: 3, max_players: 6, difficulty: 2.5, status: '대여가능' };
function Navigation() {
    const navigate = useNavigate();
    const location = useLocation();
    return <><output data-testid="url">{location.pathname + location.search}</output><button onClick={() => navigate(-1)}>브라우저 뒤로</button></>;
}
function mount(url = '/search') {
    return render(<MemoryRouter initialEntries={[url]}><Navigation /><Routes>
        <Route path="/search" element={<GameSearch />} />
        <Route path="/categories" element={<CategorySelect />} />
        <Route path="/game/:id" element={<div>상세 페이지</div>} />
    </Routes></MemoryRouter>);
}
beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    Object.assign(data, { games: [game], trending: [game], config: [], loading: false, error: null, trendingError: null, configError: null, refreshGames: vi.fn() });
    sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('stores all edited filters in URL and restores them after details/back', () => {
    mount();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '카탄' } });
    fireEvent.change(screen.getByRole('combobox', { name: '카테고리 선택' }), { target: { value: '전략' } });
    fireEvent.change(screen.getByRole('combobox', { name: '난이도 선택' }), { target: { value: '초중급' } });
    fireEvent.change(screen.getByRole('combobox', { name: '인원수 선택' }), { target: { value: '5+' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '대여 가능만' }));
    act(() => vi.advanceTimersByTime(300));
    const url = screen.getByTestId('url').textContent;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(Object.fromEntries(params)).toEqual({ query: '카탄', category: '전략', difficulty: '초중급', players: '5+', available: 'true' });
    fireEvent.click(screen.getByRole('link', { name: /카탄/ }));
    expect(screen.getByText('상세 페이지')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '브라우저 뒤로' }));
    expect(screen.getByTestId('url').textContent).toBe(url);
    expect(screen.getByRole('textbox').value).toBe('카탄');
    expect(screen.getByRole('combobox', { name: '카테고리 선택' }).value).toBe('전략');
    expect(screen.getByRole('combobox', { name: '난이도 선택' }).value).toBe('초중급');
    expect(screen.getByRole('combobox', { name: '인원수 선택' }).value).toBe('5+');
    expect(screen.getByRole('checkbox').checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /초기화/ }));
    expect(screen.getByTestId('url').textContent).toBe('/search');
    expect(screen.getByRole('checkbox').checked).toBe(false);
});

it('restores legacy player links as a selected canonical option', () => {
    mount('/search?players=6%EC%9D%B8%20%EC%9D%B4%EC%83%81');
    expect(screen.getByRole('combobox', { name: '인원수 선택' }).value).toBe('6+');
});

it.each(['/search', '/categories'])('%s displays a recoverable loading error instead of empty results', url => {
    data.error = new Error('offline');
    mount(url);
    expect(screen.getByRole('alert').textContent).toContain('불러오지 못했습니다');
    expect(screen.queryByText(/검색 결과가 없습니다/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(data.refreshGames).toHaveBeenCalledTimes(1);
});

it('category player buttons create canonical links and category cards are keyboard links', () => {
    mount('/categories');
    expect(screen.getByRole('link', { name: /전략/ }).getAttribute('href')).toBe('/search?category=%EC%A0%84%EB%9E%B5');
    expect(screen.getByRole('link', { name: /요즘 뜨는 보드게임/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '6인 이상' }));
    expect(screen.getByTestId('url').textContent).toBe('/search?players=6%2B');
    expect(screen.getByRole('combobox', { name: '인원수 선택' }).value).toBe('6+');
});

it('shows trending failures separately and explains empty seven-day rankings', () => {
    data.trendingError = new Error('offline');
    const view = mount('/search?type=trending');
    expect(screen.getByRole('alert').textContent).toContain('인기 순위를');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(data.refreshGames).toHaveBeenCalledTimes(1);
    view.unmount();
    data.trendingError = null;
    data.trending = [];
    mount('/search?type=trending');
    expect(screen.getByText('최근 7일간 집계된 인기 게임이 없습니다.')).toBeTruthy();
});

it('keeps category navigation usable while recommendation loading fails', () => {
    data.configError = new Error('offline');
    mount('/categories');
    expect(screen.getByRole('link', { name: /전략/ })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('상황별 추천');
    fireEvent.click(screen.getByRole('button', { name: '추천 다시 시도' }));
    expect(data.refreshGames).toHaveBeenCalledTimes(1);
});
