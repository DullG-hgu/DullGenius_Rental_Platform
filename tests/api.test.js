import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const database = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn() } }));
// This is a complete module replacement: no Supabase client or network is created.
vi.mock('../src/lib/supabaseClient', () => ({ supabase: database }));
import { fetchTrending, fetchGameById, fetchReviews, fetchOfficeStatus, fetchOfficeHoursConfig, sendLog, increaseViewCount } from '../src/api';

function tableResult(result) {
  const query = {
    select: vi.fn(() => query), order: vi.fn(() => query), eq: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  database.from.mockReturnValue(query);
  return query;
}
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('trending source remains the recent seven-day RPC', () => {
  it('propagates permission failures without a lifetime table fallback', async () => {
    const error = { code: '42501', message: 'permission denied' };
    database.rpc.mockResolvedValue({ data: null, error });
    await expect(fetchTrending()).rejects.toBe(error);
    expect(database.rpc).toHaveBeenCalledWith('get_trending_games');
    expect(database.from).not.toHaveBeenCalled();
  });
  it.each([[], null])('keeps an empty recent result empty (%j)', async data => {
    database.rpc.mockResolvedValue({ data, error: null });
    await expect(fetchTrending()).resolves.toEqual([]);
    expect(database.from).not.toHaveBeenCalled();
  });
  it('preserves the recent ranking order', async () => {
    const data = [{ id: 2 }, { id: 1 }]; database.rpc.mockResolvedValue({ data, error: null });
    await expect(fetchTrending()).resolves.toEqual(data);
  });
});

describe('detail reads', () => {
  it('throws a failed detail request instead of treating it as a missing game', async () => {
    const error = new Error('offline'); database.rpc.mockResolvedValue({ data: null, error });
    await expect(fetchGameById(7)).rejects.toBe(error);
    expect(database.rpc).toHaveBeenCalledWith('get_game_with_rentals', { p_game_id: 7 });
  });
  it('returns null for a successful missing game response', async () => {
    database.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchGameById(7)).resolves.toBeNull();
  });
  it('calculates inventory using the server rental rows', async () => {
    database.rpc.mockResolvedValue({ data: { id: 7, quantity: 2, rentals: [{ type: 'RENT', returned_at: null }] }, error: null });
    await expect(fetchGameById(7)).resolves.toMatchObject({ id: 7, available_count: 1, status: '대여가능' });
  });
  it('throws review failures so the page can offer retry', async () => {
    const error = new Error('offline'); tableResult({ data: null, error });
    await expect(fetchReviews(7)).rejects.toBe(error);
    expect(database.from).toHaveBeenCalledWith('reviews');
  });
  it('returns an empty list for successful empty reviews', async () => {
    tableResult({ data: [], error: null });
    await expect(fetchReviews(7)).resolves.toEqual([]);
  });
});

describe('office configuration reads', () => {
  it.each([fetchOfficeStatus, fetchOfficeHoursConfig])('propagates a failed configuration read', async fetcher => {
    const error = new Error('offline'); tableResult({ data: null, error });
    await expect(fetcher()).rejects.toBe(error);
  });
  it('defaults an absent office status to closed', async () => {
    const query = tableResult({ data: null, error: null });
    await expect(fetchOfficeStatus()).resolves.toEqual({ open: false, auto_close_at: null });
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });
  it('defaults absent office display settings', async () => {
    tableResult({ data: null, error: null });
    await expect(fetchOfficeHoursConfig()).resolves.toMatchObject({ auto_close_hour: 21, auto_close_minute: 0 });
  });
});

describe('signed-out visitors do not call RPCs that anon may not execute', () => {
    // send_user_log · increment_view_count 는 anon EXECUTE 가 없다 (2026-09-02). 부르면 401 만 남는다.
    it('skips logging and view counting without a session', async () => {
        database.auth.getSession.mockResolvedValue({ data: { session: null } });
        await sendLog(1, 'VIEW', { value: 'x' });
        await increaseViewCount(1);
        expect(database.rpc).not.toHaveBeenCalled();
    });
    it('keeps logging and view counting for signed-in users (members, kiosk)', async () => {
        database.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
        database.rpc.mockResolvedValue({ data: null, error: null });
        await sendLog(1, 'VIEW', 'Home Page');
        await increaseViewCount(7);
        expect(database.rpc).toHaveBeenCalledWith('send_user_log', { p_game_id: 1, p_action_type: 'VIEW', p_details: { value: 'Home Page' } });
        expect(database.rpc).toHaveBeenCalledWith('increment_view_count', { p_game_id: 7 });
    });
    it('treats a failing session lookup as signed out', async () => {
        database.auth.getSession.mockRejectedValue(new Error('storage blocked'));
        await sendLog(null, 'VIEW', {});
        expect(database.rpc).not.toHaveBeenCalled();
    });
});
