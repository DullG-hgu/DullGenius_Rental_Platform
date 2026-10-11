import React from 'react';
import { expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const { calls } = vi.hoisted(() => ({ calls: [] }));
vi.mock('../src/api', () => ({
  fetchExternalRentalStats: (start, end) => {
    calls.push([start, end]);
    return Promise.resolve({
      period: { start, end }, requests: 4, by_status: { manual_confirmed: 1, returned: 2, cancelled: 1 },
      rentals: 9, rentals_open: 3, rentals_returned: 6, game_copies: 9, avg_duration_days: 3.25, overdue: 2, overdue_open: 1,
      top_games: [{ game_id: 1, name: '카탄', copies: 3, requests: 2 }],
    });
  },
}));

import ExternalRentalStatsPanel, { kstPeriod } from '../src/admin/ExternalRentalStatsPanel';

it('kstPeriod: KST 오늘을 끝으로 N일, 양끝 포함', () => {
  // 10/12 01:00 KST = 10/11 16:00 UTC — UTC 날짜가 아니라 KST 날짜로 끊는다
  expect(kstPeriod(7, new Date('2026-10-11T16:00:00Z'))).toEqual({ start: '2026-10-06', end: '2026-10-12' });
  expect(kstPeriod(1, new Date('2026-10-11T16:00:00Z'))).toEqual({ start: '2026-10-12', end: '2026-10-12' });
});

it('통계 탭 기간으로 불러와 회원 통계와 따로 보여 준다', async () => {
  await act(async () => { render(<ExternalRentalStatsPanel period={30} />); });
  expect(calls).toHaveLength(1);
  expect(screen.getByRole('heading', { name: '외부 대여 (행사·단체)' })).toBeTruthy();
  expect(screen.getByText('단체 연체 (진행 중)')).toBeTruthy();
  expect(screen.getByText('3.3')).toBeTruthy(); // 평균 기간 소수 한 자리
  expect(screen.getByText('반납 완료 2')).toBeTruthy();
  expect(screen.getByText(/카탄/)).toBeTruthy();
});
