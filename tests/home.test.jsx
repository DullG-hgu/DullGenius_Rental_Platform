import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../src/pages/Home';

const { data, auth, fetchOfficeStatus, fetchOfficeHoursConfig } = vi.hoisted(() => ({
    data: {}, auth: {}, fetchOfficeStatus: vi.fn(), fetchOfficeHoursConfig: vi.fn(),
}));
vi.mock('../src/contexts/GameDataContext', () => ({ useGameData: () => data }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../src/api_fun', () => ({
    fetchWorldcupRanking: () => Promise.resolve({ items: [] }),
    fetchTierCommunity: () => Promise.resolve({ items: [], min_sample: 3 }),
    fetchMyTier: () => Promise.resolve(null),
    saveMyTier: () => Promise.resolve({ ok: true }),
    setTierPublic: () => Promise.resolve(true),
}));
vi.mock('../src/api', () => ({ sendLog: vi.fn(), fetchOfficeStatus, fetchOfficeHoursConfig }));
vi.mock('../src/components/Header', () => ({ default: () => null }));
vi.mock('../src/components/InfoBar', () => ({ default: () => null }));
vi.mock('../src/components/InfoModal', () => ({ default: () => null }));
vi.mock('../src/components/PoweredByBGG', () => ({ default: () => null }));
const mount = async () => {
    let view;
    await act(async () => { view = render(<MemoryRouter><Home /></MemoryRouter>); });
    return view;
};
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T08:59:50Z'));
    Object.assign(data, { games: [], trending: [], config: null, loading: false, error: null, trendingError: null, refreshGames: vi.fn() });
    Object.assign(auth, { user: null, profile: null, roles: [], loading: false });
    fetchOfficeStatus.mockReset().mockResolvedValue({ open: true, auto_close_at: '2026-09-08T09:00:00Z' });
    fetchOfficeHoursConfig.mockReset().mockResolvedValue({ schedule_text: '평일 17~18시 운영', auto_close_hour: 18 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('hides the office card at the deadline without requiring a server refresh (closed = nothing shown)', async () => {
    await mount();
    expect(screen.getByText(/18:00에 오피스아워가 끝나요/)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByText(/오피스아워/)).toBeNull();
    expect(screen.queryByText('평일 17~18시 운영')).toBeNull();
    expect(fetchOfficeStatus).toHaveBeenCalledTimes(1);
});

it('uses Korean office time when only configured closing time is available', async () => {
    fetchOfficeStatus.mockResolvedValue({ open: true });
    await mount();
    expect(screen.getByText(/18:00에 오피스아워가 끝나요/)).toBeTruthy();
});

it('refreshes office status on poll, focus and visibility, and cleans up after unmount', async () => {
    const view = await mount();
    fetchOfficeStatus.mockResolvedValue({ open: false });
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(fetchOfficeStatus).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.focus(window); });
    expect(fetchOfficeStatus).toHaveBeenCalledTimes(3);
    await act(async () => { fireEvent(document, new Event('visibilitychange')); });
    expect(fetchOfficeStatus).toHaveBeenCalledTimes(4);
    view.unmount();
    await act(async () => { vi.advanceTimersByTime(30_000); fireEvent.focus(window); });
    expect(fetchOfficeStatus).toHaveBeenCalledTimes(4);
});

it('shows nothing when the office status fails to load, and recovers on the next poll', async () => {
    fetchOfficeStatus.mockRejectedValue(new Error('offline'));
    await mount();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/오피스아워/)).toBeNull();
    fetchOfficeStatus.mockResolvedValue({ open: true });
    fetchOfficeHoursConfig.mockResolvedValue({ banner_title: '오피스아워 진행 중!' });
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByText('오피스아워 진행 중!')).toBeTruthy();
});

it('offers native links for search, browsing, ranked games, the full ranking and the playground', async () => {
    data.trending = Array.from({ length: 6 }, (_, id) => ({ id, name: `게임 ${id}`, category: '전략' }));
    await mount();
    const search = screen.getByRole('link', { name: /어떤 게임을 찾으세요/ });
    expect(search.getAttribute('href')).toBe('/search');
    search.focus();
    expect(document.activeElement).toBe(search);
    expect(screen.getByRole('link', { name: /게임 모두 보기/ }).getAttribute('href')).toBe('/search');
    expect(screen.getByRole('link', { name: /카테고리별로/ }).getAttribute('href')).toBe('/categories');
    expect(screen.getByRole('link', { name: /게임 0/ }).getAttribute('href')).toBe('/game/0');
    expect(screen.getByRole('link', { name: '전체 순위' }).getAttribute('href')).toBe('/search?type=trending');
    // 놀이터 입구는 하나 — 월드컵·티어표·성향검사는 허브에서
    expect(screen.getByRole('link', { name: /놀이터 입장/ }).getAttribute('href')).toBe('/play');
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/play/'))).toHaveLength(0);
});

it('puts non-member short-term rental near the top only for signed-out visitors', async () => {
    const view = await mount();
    expect(screen.getByRole('link', { name: /비회원 단기 대여/ }).getAttribute('href')).toBe('/org-rental');
    view.unmount();
    Object.assign(auth, { user: { id: 'u1' }, profile: { name: '부원', is_paid: true } });
    await mount();
    expect(screen.queryByRole('link', { name: /비회원 단기 대여/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /부원 가입 신청/ })).toBeNull();
});

it('shows admin recommendation bundles as switchable tags with a detail link', async () => {
    data.games = [
        { id: 1, name: '카탄', category: '보드게임', tags: '#팀모임' },
        { id: 2, name: '스플렌더', category: '보드게임', tags: '#룸메' },
    ];
    data.config = [
        { key: 'a', label: '🎲 팀모임 추천', value: '#팀모임' },
        { key: 'b', label: '🏠 룸메 추천', value: '#룸메' },
    ];
    await mount();
    expect(screen.getByRole('tab', { name: '#팀모임', selected: true })).toBeTruthy();
    expect(screen.getByRole('link', { name: /카탄/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /자세히 보기/ }).getAttribute('href')).toBe(`/search?query=${encodeURIComponent('#팀모임')}`);
    await act(async () => { vi.advanceTimersByTime(6_000); });
    expect(screen.getByRole('tab', { name: '#룸메', selected: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '#팀모임' }));
    await act(async () => { vi.advanceTimersByTime(12_000); });
    expect(screen.getByRole('tab', { name: '#팀모임', selected: true })).toBeTruthy();
});

it.each(['error', 'trendingError'])('shows %s with retry instead of zero-game rankings', async key => {
    data[key] = new Error('offline');
    await mount();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('최근 7일간 집계된 인기 게임이 없습니다.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '게임 목록 다시 시도' }));
    expect(data.refreshGames).toHaveBeenCalledTimes(1);
});

it('explains an empty successful ranking', async () => {
    await mount();
    expect(screen.getByText('최근 7일간 집계된 인기 게임이 없습니다.')).toBeTruthy();
});
