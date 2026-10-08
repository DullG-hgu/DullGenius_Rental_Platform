import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GUEST_TTL_MS, loadProgress, MEMBER_TTL_MS, saveProgress, clearProgress } from '../src/fun/worldcup/worldcupProgress';

const { auth, openRun } = vi.hoisted(() => ({ auth: {}, openRun: { value: null } }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../src/api_fun', () => ({
    fetchWorldcupThemes: () => Promise.resolve([
        { slug: 'all-boardgames', title: '보드게임 이상형 월드컵', description: '', allowed_sizes: [8, 16], pool_count: 174, total_pool_count: 174, play_count: 3 },
    ]),
    fetchMyOpenWorldcupRun: () => Promise.resolve(openRun.value),
}));

const run = {
    run_id: 'run-1', slug: 'all-boardgames', title: 't', size: 8, top_first: [true, true, true, true, true, true, true],
    candidates: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, name: `g${id}` })),
};

beforeEach(() => { clearProgress(); Object.assign(auth, { user: null, loading: false }); openRun.value = null; });
afterEach(() => { vi.useRealTimers(); });

describe('progress lifetime', () => {
    it('keeps a guest run for 5 hours and a member run for 3 days', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-29T00:00:00Z'));
        saveProgress(run, [], [], GUEST_TTL_MS);
        vi.setSystemTime(new Date('2026-09-29T05:30:00Z'));
        expect(loadProgress()).toBeNull();

        vi.setSystemTime(new Date('2026-09-29T00:00:00Z'));
        saveProgress(run, [], [], MEMBER_TTL_MS);
        vi.setSystemTime(new Date('2026-10-01T23:00:00Z'));
        expect(loadProgress()?.run.run_id).toBe('run-1');
        vi.setSystemTime(new Date('2026-10-02T01:00:00Z'));
        expect(loadProgress()).toBeNull();
    });
});

describe('resume a member run started on another device', () => {
    it('offers 이어하기 from the server when this device has nothing saved', async () => {
        const { default: WorldcupThemes } = await import('../src/fun/worldcup/WorldcupThemes');
        Object.assign(auth, { user: { id: 'u1' }, loading: false });
        openRun.value = { run, picks: [{ w: 1 }, { w: 3 }], unplayed: [3], last_activity: new Date().toISOString() };

        await act(async () => { render(<MemoryRouter><WorldcupThemes /></MemoryRouter>); });

        // 8강 3번째 대결에서 이어하기 — 테마가 하나뿐이라 설정 화면에 바로 「이어하기 (8강 3/4)」 버튼
        expect(screen.getByRole('button', { name: /이어하기 \(8강 3\/4\)/ })).toBeTruthy();
        expect(loadProgress()?.unplayed).toEqual([3]);
    });

    it('does not look up the server for signed-out visitors', async () => {
        const { default: WorldcupThemes } = await import('../src/fun/worldcup/WorldcupThemes');
        openRun.value = { run, picks: [{ w: 1 }], unplayed: [], last_activity: new Date().toISOString() };
        await act(async () => { render(<MemoryRouter><WorldcupThemes /></MemoryRouter>); });
        expect(screen.queryByText(/이어하기/)).toBeNull();
    });
});
