import React from 'react';
import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import WorldcupStatsPanel from '../src/admin/WorldcupStatsPanel';

const { api } = vi.hoisted(() => ({ api: { calls: [] } }));

vi.mock('../src/api_fun', () => ({
    fetchWorldcupAdminStats: (args) => {
        api.calls.push(['stats', args]);
        return Promise.resolve({
            runs: { member: { finished: 3, abandoned: 1 }, nonmember: { finished: 2, started: 1 } },
            distinct_members: 2, distinct_devices: 3,
            completion_by_size: [{ size: 16, started: 5, finished: 4, rate: 0.8 }],
            dropoff: [{ size: 64, reached_round: 32, runs: 1, avg_played: 40 }],
            matches: 120, matches_from_unfinished: 30, top_pick_rate: 0.51, median_decide_ms: 2400,
        });
    },
    fetchWorldcupRanking: (slug, scope) => {
        api.calls.push(['ranking', scope]);
        return Promise.resolve({
            total_runs: 5, min_matches: 10,
            items: [
                { id: 1, name: '스컬킹', ranked: true, win_rate: 0.8, wins: 8, losses: 2, championships: 2, champion_rate: 0.5, unplayed_wins: 1, unplayed_losses: 0 },
                { id: 2, name: '도미니언', ranked: false, win_rate: 1, wins: 3, losses: 0, championships: 0, champion_rate: null, unplayed_wins: 0, unplayed_losses: 0 },
            ],
        });
    },
    fetchWorldcupInsights: (slug, scope) => {
        api.calls.push(['insights', scope]);
        return Promise.resolve({
            marking_runs: 2, min_sample: 5,
            items: [
                { id: 1, name: '스컬킹', familiarity: 0.7, curiosity_rate: null, experienced_rate: 0.8, signal: 'classic' },
                { id: 3, name: '미표본', familiarity: null, curiosity_rate: null, experienced_rate: null, signal: null },
            ],
        });
    },
}));

it('shows run summary, ranking and 「안 해봄」 insights, and reloads with the chosen scope', async () => {
    await act(async () => { render(<WorldcupStatsPanel />); });

    expect(screen.getByText('끝까지 한 판')).toBeTruthy();
    expect(screen.getByText('5 (71.4%)')).toBeTruthy(); // 완료 5 / 시작 7
    expect(screen.getByText('2.4초')).toBeTruthy();
    expect(screen.getAllByText('스컬킹').length).toBe(2); // 랭킹 + 인사이트
    expect(screen.getByText('검증된 명작')).toBeTruthy();
    expect(screen.queryByText('미표본')).toBeNull(); // 표본 없는 게임은 숨김

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '회원만' })); });
    expect(api.calls.filter(([k]) => k === 'ranking').map(([, s]) => s)).toEqual(['all', 'member']);
});
