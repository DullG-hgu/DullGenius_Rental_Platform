import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameProvider, useGameData } from '../src/contexts/GameDataContext';
import { fetchGames, fetchTrending, fetchConfig } from '../src/api';
const auth = vi.hoisted(() => ({ user: null, loading: false }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../src/api', () => ({ fetchGames: vi.fn(), fetchTrending: vi.fn(), fetchConfig: vi.fn() }));
vi.mock('../src/lib/gamesRealtime', () => ({ subscribeToGameChanges: () => () => {} }));
function Probe() {
  const data = useGameData();
  return <div><span>{data.loading ? 'loading' : data.games.map(g => g.name).join(',')}</span>{data.error && <span>games failed</span>}{data.trendingError && <span>trending failed</span>}<button onClick={data.refreshGames}>refresh</button></div>;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  vi.resetAllMocks(); auth.user = null; auth.loading = false; localStorage.clear();
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
