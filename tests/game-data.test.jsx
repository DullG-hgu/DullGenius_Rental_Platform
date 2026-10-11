import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameProvider, isRelevantGameChange, useGameData, useSuspendGameData } from '../src/contexts/GameDataContext';
import { fetchGames, fetchGamesByIds, fetchTrending, fetchConfig } from '../src/api';
const auth = vi.hoisted(() => ({ user: null, loading: false }));
const realtime = vi.hoisted(() => ({ opts: null }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../src/api', () => ({ fetchGames: vi.fn(), fetchGamesByIds: vi.fn(), fetchTrending: vi.fn(), fetchConfig: vi.fn() }));
vi.mock('../src/lib/gamesRealtime', () => ({ subscribeToGameChanges: (opts) => { realtime.opts = opts; return () => {}; } }));
function Probe() {
  const data = useGameData();
  return <div><span>{data.loading ? 'loading' : data.games.map(g => g.name).join(',')}</span><span data-testid="trending">{data.trending.map(g => `${g.name}:${g.available_count}`).join(',')}</span>{data.error && <span>games failed</span>}{data.trendingError && <span>trending failed</span>}<button onClick={data.refreshGames}>refresh</button></div>;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  vi.resetAllMocks(); realtime.opts = null; window.history.replaceState(null, '', '/'); auth.user = null; auth.loading = false; localStorage.clear();
  fetchGames.mockResolvedValue([{ id: 1, name: 'Game' }]); fetchTrending.mockResolvedValue([]); fetchConfig.mockResolvedValue({});
});
afterEach(cleanup);
describe('game data', () => {
  it('keeps successful game data available when trending fails', async () => {
    fetchTrending.mockRejectedValue(new Error('offline'));
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('Game'); expect(screen.getByText('trending failed')).toBeTruthy();
    expect(screen.queryByText('games failed')).toBeNull();
  });
  it('shows loading while retrying an empty failed list, then recovers', async () => {
    const retry = deferred();
    fetchGames.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(retry.promise);
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('games failed');
    fireEvent.click(screen.getByText('refresh'));
    expect(screen.getByText('loading')).toBeTruthy();
    await act(async () => retry.resolve([{ id: 1, name: 'Recovered' }]));
    expect(screen.getByText('Recovered')).toBeTruthy();
    expect(screen.queryByText('games failed')).toBeNull();
  });
  it('preserves visible games if a background refresh fails', async () => {
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('Game');
    fetchGames.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByText('refresh'));
    await screen.findByText('games failed');
    expect(screen.getByText('Game')).toBeTruthy();
  });
  it('ignores a slower refresh response that started before a newer refresh', async () => {
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('Game');
    const older = deferred();
    fetchGames.mockReturnValueOnce(older.promise).mockResolvedValueOnce([{ id: 1, name: 'Latest' }]);
    fireEvent.click(screen.getByText('refresh'));
    fireEvent.click(screen.getByText('refresh'));
    await screen.findByText('Latest');
    await act(async () => older.resolve([{ id: 1, name: 'Old' }]));
    expect(screen.getByText('Latest')).toBeTruthy();
    expect(screen.queryByText('Old')).toBeNull();
  });
  it('does not hydrate old private caches or read before auth settles', async () => {
    auth.loading = true;
    localStorage.setItem('games_cache', JSON.stringify({ data: [{ id: 1, name: 'Private' }], timestamp: Date.now() }));
    const view = render(<GameProvider><Probe /></GameProvider>);
    expect(fetchGames).not.toHaveBeenCalled(); expect(screen.queryByText('Private')).toBeNull();
    auth.loading = false; view.rerender(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('Game'); expect(localStorage.getItem('games_cache')).toBeNull();
  });
  it('discards an older account response after switching accounts', async () => {
    const older = deferred(); auth.user = { id: 'first' };
    fetchGames.mockReturnValueOnce(older.promise).mockResolvedValueOnce([{ id: 2, name: 'Second' }]);
    const view = render(<GameProvider><Probe /></GameProvider>);
    await waitFor(() => expect(fetchGames).toHaveBeenCalledTimes(1));
    auth.user = { id: 'second' }; view.rerender(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('Second');
    await act(async () => older.resolve([{ id: 1, name: 'Private first account' }]));
    expect(screen.queryByText('Private first account')).toBeNull(); expect(screen.getByText('Second')).toBeTruthy();
  });
});

describe('lighter refreshes (2026-10-10)', () => {
  it('a realtime stock change reloads only the game list and re-points trending at the new objects', async () => {
    fetchGames.mockResolvedValue([{ id: 1, name: 'Game', available_count: 1 }]);
    fetchTrending.mockResolvedValue([{ id: 1 }]);
    render(<GameProvider><Probe /></GameProvider>);
    await waitFor(() => expect(screen.getByTestId('trending').textContent).toBe('Game:1'));
    expect(fetchTrending).toHaveBeenCalledTimes(1);
    fetchGames.mockResolvedValue([{ id: 1, name: 'Game', available_count: 0 }]);
    await act(async () => { await realtime.opts.onChange(); });
    expect(fetchGames).toHaveBeenCalledTimes(2);
    expect(fetchTrending).toHaveBeenCalledTimes(1);
    expect(fetchConfig).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('trending').textContent).toBe('Game:0');
  });
  it('a games-only refresh still loads everything when nothing has been loaded yet', async () => {
    fetchGames.mockRejectedValueOnce(new Error('offline'));
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('games failed');
    await act(async () => { await realtime.opts.onChange(); });
    expect(fetchTrending).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Game')).toBeTruthy();
  });
  it('the manual retry button keeps doing a full refresh', async () => {
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('Game');
    fireEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(fetchTrending).toHaveBeenCalledTimes(2));
    expect(fetchConfig).toHaveBeenCalledTimes(2);
  });
  it('stays idle on the kiosk screen and resumes after leaving it', async () => {
    window.history.replaceState(null, '', '/kiosk');
    function Kiosk() { useSuspendGameData(); return null; }
    const view = render(<GameProvider><Kiosk /><Probe /></GameProvider>);
    await act(async () => {});
    expect(fetchGames).not.toHaveBeenCalled();
    expect(realtime.opts).toBeNull();
    window.history.replaceState(null, '', '/');
    view.rerender(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('Game');
    expect(fetchGames).toHaveBeenCalledTimes(1);
    expect(realtime.opts).not.toBeNull();
  });
});

describe('realtime game changes', () => {
  const games = [{ id: 1, name: 'Game', available_count: 1, total_views: 10, genres: ['전략'] }];
  it('ignores a view-count-only update (no full reload for every visitor)', () => {
    expect(isRelevantGameChange({ new: { id: 1, name: 'Game', available_count: 1, total_views: 11, genres: ['전략'] } }, games)).toBe(false);
  });
  it('reloads when stock or shown info changes, or the game is unknown', () => {
    expect(isRelevantGameChange({ new: { id: 1, name: 'Game', available_count: 0, total_views: 10 } }, games)).toBe(true);
    expect(isRelevantGameChange({ new: { id: 1, name: 'Game', available_count: 1, genres: ['파티'] } }, games)).toBe(true);
    expect(isRelevantGameChange({ new: { id: 2, name: 'New', available_count: 1 } }, games)).toBe(true);
    expect(isRelevantGameChange({}, games)).toBe(true);
  });
  it('compares stock with the raw DB value, not the recomputed screen value', () => {
    const shown = [{ id: 1, name: 'Game', available_count: 1, db_available_count: 0, total_views: 3 }];
    expect(isRelevantGameChange({ new: { id: 1, name: 'Game', available_count: 0, total_views: 4 } }, shown)).toBe(false);
    expect(isRelevantGameChange({ new: { id: 1, name: 'Game', available_count: 1, total_views: 4 } }, shown)).toBe(true);
  });
});

describe('realtime single-game patch (2026-10-11)', () => {
  const two = [{ id: 1, name: 'A', available_count: 1 }, { id: 2, name: 'B', available_count: 1 }];
  beforeEach(() => { fetchGames.mockResolvedValue(two); fetchTrending.mockResolvedValue([{ id: 2 }]); });
  it('a change to known games re-reads only those games, keeps order, and re-points trending', async () => {
    render(<GameProvider><Probe /></GameProvider>);
    await waitFor(() => expect(screen.getByTestId('trending').textContent).toBe('B:1'));
    fetchGamesByIds.mockResolvedValue([{ id: 2, name: 'B', available_count: 0 }]);
    await act(async () => { await realtime.opts.onChange([2]); });
    expect(fetchGamesByIds).toHaveBeenCalledWith([2]);
    expect(fetchGames).toHaveBeenCalledTimes(1);
    expect(screen.getByText('A,B')).toBeTruthy();
    expect(screen.getByTestId('trending').textContent).toBe('B:0');
  });
  it('falls back to the full list when the single read fails', async () => {
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('A,B');
    fetchGamesByIds.mockRejectedValue(new Error('offline'));
    await act(async () => { await realtime.opts.onChange([1]); });
    await waitFor(() => expect(fetchGames).toHaveBeenCalledTimes(2));
    expect(fetchTrending).toHaveBeenCalledTimes(1);
  });
  it('reads the full list for unknown ids, an unknown game, or a bulk change', async () => {
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('A,B');
    await act(async () => { await realtime.opts.onChange(null); });
    await act(async () => { await realtime.opts.onChange([3]); });
    expect(fetchGamesByIds).not.toHaveBeenCalled();
    expect(fetchGames).toHaveBeenCalledTimes(3);
  });
  it('drops a single-game result if a full refresh started meanwhile', async () => {
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('A,B');
    const slow = deferred();
    fetchGamesByIds.mockReturnValueOnce(slow.promise);
    let patch;
    act(() => { patch = realtime.opts.onChange([1]); });
    fetchGames.mockResolvedValue([{ id: 1, name: 'A', available_count: 7 }, { id: 2, name: 'B', available_count: 1 }]);
    fireEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(fetchGames).toHaveBeenCalledTimes(2));
    await act(async () => { slow.resolve([{ id: 1, name: 'Stale', available_count: 0 }]); await patch; });
    expect(screen.queryByText(/Stale/)).toBeNull();
  });
});

describe('single-game patch ordering (2026-10-11 verification)', () => {
  const two = [{ id: 1, name: 'A', available_count: 1 }, { id: 2, name: 'B', available_count: 1 }];
  beforeEach(() => { fetchGames.mockResolvedValue(two); fetchTrending.mockResolvedValue([]); });
  it('an older read of the same game arriving last does not overwrite the newer one', async () => {
    fetchTrending.mockResolvedValue([{ id: 1 }]);
    render(<GameProvider><Probe /></GameProvider>);
    await waitFor(() => expect(screen.getByTestId('trending').textContent).toBe('A:1'));
    const older = deferred(); const newer = deferred();
    fetchGamesByIds.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    let p1, p2;
    act(() => { p1 = realtime.opts.onChange([1]); });
    act(() => { p2 = realtime.opts.onChange([1]); });
    await act(async () => { newer.resolve([{ id: 1, name: 'A', available_count: 0 }]); await p2; });
    await act(async () => { older.resolve([{ id: 1, name: 'A', available_count: 5 }]); await p1; });
    expect(screen.getByTestId('trending').textContent).toBe('A:0');
    expect(fetchGames).toHaveBeenCalledTimes(1);
  });
  it('a renamed game reloads the list instead of patching in place', async () => {
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('A,B');
    fetchGamesByIds.mockResolvedValue([{ id: 1, name: 'Z', available_count: 1 }]);
    fetchGames.mockResolvedValue([two[1], { id: 1, name: 'Z', available_count: 1 }]);
    await act(async () => { await realtime.opts.onChange([1]); });
    await screen.findByText('B,Z');
  });
  it('a change during a full refresh triggers a newer full refresh, not a patch', async () => {
    render(<GameProvider><Probe /></GameProvider>);
    await screen.findByText('A,B');
    const slow = deferred();
    fetchGames.mockReturnValueOnce(slow.promise);
    fireEvent.click(screen.getByText('refresh'));
    await act(async () => { await realtime.opts.onChange([1]); });
    expect(fetchGamesByIds).not.toHaveBeenCalled();
    await act(async () => slow.resolve(two));
  });
});

