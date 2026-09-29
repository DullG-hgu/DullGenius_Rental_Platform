import React from 'react';
import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import GameInfoReportsPanel from '../src/admin/GameInfoReportsPanel';

const { store, toast } = vi.hoisted(() => ({
    store: {
        rows: [
            {
                id: 'r1', game_id: 260, game_name: '스컬킹', field: 'players', shown_value: '2~6인', note: '실제로는 2~8인',
                source: 'worldcup', is_member: false, reporter_name: null, status: 'pending', created_at: '2026-09-29T11:52:30Z',
                current: { min_players: 2, max_players: 8, playingtime: '30분', image: null },
            },
        ],
        updates: [],
    },
    toast: [],
}));

vi.mock('../src/api_fun', () => ({
    fetchGameInfoReports: (status) => Promise.resolve(store.rows.filter((r) => !status || r.status === status)),
    setGameInfoReportStatus: (id, status) => {
        store.updates.push([id, status]);
        store.rows = store.rows.map((r) => (r.id === id ? { ...r, status } : r));
        return Promise.resolve();
    },
}));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast: (m) => toast.push(m) }) }));

it('lists pending reports with the reported vs current value and resolves them', async () => {
    const counts = [];
    await act(async () => { render(<GameInfoReportsPanel onPendingCount={(n) => counts.push(n)} />); });

    expect(screen.getByText('스컬킹')).toBeTruthy();
    expect(screen.getByText('인원수')).toBeTruthy();
    expect(screen.getByText('2~6인')).toBeTruthy();
    expect(screen.getByText('2~8인')).toBeTruthy();
    expect(screen.getByText('(수정됨)')).toBeTruthy();
    expect(screen.getByText('실제로는 2~8인')).toBeTruthy();
    expect(screen.getByRole('link', { name: '게임 보기' }).getAttribute('href')).toBe('/game/260');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '완료 처리' })); });
    expect(store.updates).toEqual([['r1', 'resolved']]);
    expect(screen.queryByText('스컬킹')).toBeNull();
    expect(screen.getByText('처리할 신고가 없어요.')).toBeTruthy();
    expect(counts.at(-1)).toBe(0);
    expect(toast.at(-1)).toContain('처리 완료');
});
