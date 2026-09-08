import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../src/pages/Home';

const { data, fetchOfficeStatus, fetchOfficeHoursConfig } = vi.hoisted(() => ({
    data: {}, fetchOfficeStatus: vi.fn(), fetchOfficeHoursConfig: vi.fn(),
}));
vi.mock('../src/contexts/GameDataContext', () => ({ useGameData: () => data }));
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
    Object.assign(data, { games: [], trending: [], loading: false, error: null, trendingError: null, refreshGames: vi.fn() });
    fetchOfficeStatus.mockReset().mockResolvedValue({ open: true, auto_close_at: '2026-09-08T09:00:00Z' });
    fetchOfficeHoursConfig.mockReset().mockResolvedValue({ schedule_text: '평일 17~18시 운영', auto_close_hour: 18 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('updates the closing banner at the deadline without requiring a server refresh', async () => {
    await mount();
    expect(screen.getByText(/18:00에 오피스아워가 끝나요/)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByText(/오피스아워가 끝나요/)).toBeNull();
    expect(screen.getByText('평일 17~18시 운영')).toBeTruthy();
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

it('does not label an office fetch error as closed and supports retry', async () => {
    fetchOfficeStatus.mockRejectedValue(new Error('offline'));
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('운영 상태를 확인하지 못했습니다');
    expect(screen.queryByText('평일 17~18시 운영')).toBeNull();
    fetchOfficeStatus.mockResolvedValue({ open: false });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '운영 상태 다시 시도' })); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('평일 17~18시 운영')).toBeTruthy();
});

it('offers native links for main navigation, ranked games and the full ranking', async () => {
    data.trending = Array.from({ length: 6 }, (_, id) => ({ id, name: `게임 ${id}`, category: '전략' }));
    await mount();
    const category = screen.getByRole('link', { name: /추천 보드게임/ });
    expect(category.getAttribute('href')).toBe('/categories');
    category.focus();
    expect(document.activeElement).toBe(category);
    expect(screen.getByRole('link', { name: /직접 검색하기/ }).getAttribute('href')).toBe('/search');
    expect(screen.getByRole('link', { name: /게임 0/ }).getAttribute('href')).toBe('/game/0');
    expect(screen.getByRole('link', { name: /인기 순위 더보기/ }).getAttribute('href')).toBe('/search?type=trending');
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
