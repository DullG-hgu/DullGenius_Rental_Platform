import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import useKioskData from '../src/hooks/useKioskData';
import { fetchGames, fetchGamesByIds } from '../src/api';

const realtime = vi.hoisted(() => ({ opts: null }));
vi.mock('../src/api', () => ({ fetchGames: vi.fn(), fetchGamesByIds: vi.fn(), kioskListUsers: vi.fn() }));
vi.mock('../src/lib/gamesRealtime', () => ({ subscribeToGameChanges: (opts) => { realtime.opts = opts; return () => {}; } }));

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const two = [{ id: 1, name: 'A', available_count: 1 }, { id: 2, name: 'B', available_count: 1 }];

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); realtime.opts = null; fetchGames.mockResolvedValue(two); });
afterEach(cleanup);

const mount = async () => {
  const view = renderHook(() => useKioskData({ includeUsers: false }));
  await waitFor(() => expect(view.result.current.games).toHaveLength(2));
  return view;
};

describe('kiosk single-game patch (2026-10-11)', () => {
  it('re-reads only the changed game and caches the merged list', async () => {
    const { result } = await mount();
    fetchGamesByIds.mockResolvedValue([{ id: 2, name: 'B', available_count: 0 }]);
    await act(async () => { await realtime.opts.onChange([2]); });
    expect(fetchGames).toHaveBeenCalledTimes(1);
    expect(result.current.games.map(g => g.available_count)).toEqual([1, 0]);
    expect(JSON.parse(localStorage.getItem('kiosk_games'))[1].available_count).toBe(0);
  });
  it('an older read of the same game arriving last does not overwrite the newer one', async () => {
    const { result } = await mount();
    const older = deferred(); const newer = deferred();
    fetchGamesByIds.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    let p1, p2;
    act(() => { p1 = realtime.opts.onChange([1]); p2 = realtime.opts.onChange([1]); });
    await act(async () => { newer.resolve([{ id: 1, name: 'A', available_count: 0 }]); await p2; });
    await act(async () => { older.resolve([{ id: 1, name: 'A', available_count: 5 }]); await p1; });
    expect(result.current.games[0].available_count).toBe(0);
  });
  it('a patch is dropped once a full list request started after it', async () => {
    const { result } = await mount();
    const slow = deferred();
    fetchGamesByIds.mockReturnValueOnce(slow.promise);
    let patch;
    act(() => { patch = realtime.opts.onChange([1]); });
    fetchGames.mockResolvedValue([{ id: 1, name: 'A', available_count: 9 }, two[1]]);
    await act(async () => { await realtime.opts.onChange(null); });
    await act(async () => { slow.resolve([{ id: 1, name: 'A', available_count: 0 }]); await patch; });
    expect(result.current.games[0].available_count).toBe(9);
  });
  it('a rename or a failed read falls back to the full list', async () => {
    await mount();
    fetchGamesByIds.mockResolvedValueOnce([{ id: 1, name: 'Z', available_count: 1 }]).mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await realtime.opts.onChange([1]); });
    await act(async () => { await realtime.opts.onChange([2]); });
    expect(fetchGames).toHaveBeenCalledTimes(3);
  });
});
