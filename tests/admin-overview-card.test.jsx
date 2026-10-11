import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { data } = vi.hoisted(() => ({ data: { reports: [], requests: [], rentals: [], rentalArgs: [], failReports: false } }));

vi.mock('../src/api', () => ({
  fetchDamageReports: () => (data.failReports ? Promise.reject(new Error('down')) : Promise.resolve(data.reports)),
  fetchGameRequests: () => Promise.resolve(data.requests),
  fetchRentalRequests: (statuses) => { data.rentalArgs.push(statuses); return Promise.resolve(data.rentals); },
}));

import AdminOverviewCard from '../src/admin/AdminOverviewCard';

const kst = (s) => new Date(`${s}+09:00`);
const overdueGame = { id: 1, name: '카탄', adminStatus: '대여중', dueDate: kst('2026-10-10T00:00:00').toISOString() };
const okGame = { id: 2, name: '스플렌더', adminStatus: '대여중', dueDate: kst('2026-10-20T00:00:00').toISOString() };

beforeEach(() => {
  data.reports = []; data.requests = []; data.rentals = []; data.rentalArgs = []; data.failReports = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(kst('2026-10-12T12:00:00'));
});
afterEach(() => vi.useRealTimers());

const renderCard = async (props) => {
  let utils;
  await act(async () => { utils = render(<AdminOverviewCard {...props} />); });
  return utils;
};

it('할 일이 하나도 없으면 섹션째 숨긴다 (오피스아워 꺼짐·연체 0·신청 0·신고 0)', async () => {
  const { container } = await renderCard({ games: [okGame], isOfficeOpen: false });
  expect(container.innerHTML).toBe('');
});

it('불러오는 동안은 숨긴다 — 게임 목록 첫 로딩 중이면 카운트가 와도 숨김', async () => {
  data.reports = [{ status: 'pending' }];
  const { container } = await renderCard({ games: [], gamesLoading: true, isOfficeOpen: true });
  expect(container.innerHTML).toBe('');
});

it('오피스아워는 켜져 있을 때만 한 줄 — [끄기]', async () => {
  const onGoOffice = vi.fn();
  await renderCard({ games: [], isOfficeOpen: true, onGoOffice });
  expect(screen.getByText('오피스아워 켜짐')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '끄기' }));
  expect(onGoOffice).toHaveBeenCalled();
  expect(screen.queryByText('반납 기한 지남')).toBeNull();
  expect(screen.queryByText(/외부 대여 신청/)).toBeNull();
  expect(screen.queryByText(/미처리/)).toBeNull();
  expect(screen.queryByText('오늘의 할 일')).toBeNull(); // 제목 줄 없음
});

it('연체가 있으면 「반납 기한 지남 N건 [대여자별 처리]」', async () => {
  const onOpenWorkList = vi.fn();
  await renderCard({ games: [overdueGame, okGame], isOfficeOpen: false, onOpenWorkList });
  expect(screen.queryByText('오피스아워 켜짐')).toBeNull();
  expect(screen.getByText('반납 기한 지남')).toBeTruthy();
  expect(screen.getByText('1건')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '대여자별 처리' }));
  expect(onOpenWorkList).toHaveBeenCalled();
});

it('외부 대여 신청은 대기·검토 필요만 센다 (확정 건 제외)', async () => {
  data.rentals = [{ status: 'pending' }, { status: 'needs_review' }, { status: 'auto_confirmed' }];
  const onGoRentalRequests = vi.fn();
  await renderCard({ games: [], isOfficeOpen: false, onGoRentalRequests });
  expect(data.rentalArgs[0]).toEqual(['pending', 'needs_review']);
  expect(screen.getByText('외부 대여 신청')).toBeTruthy();
  expect(screen.getByText('2건')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '보기' }));
  expect(onGoRentalRequests).toHaveBeenCalled();
});

it('미처리 신고·게임 신청은 각각 1건 이상일 때만 한 줄씩', async () => {
  data.reports = [{ status: 'pending' }, { status: 'resolved' }];
  data.requests = [];
  await renderCard({ games: [], isOfficeOpen: false, onGoReports: vi.fn() });
  expect(screen.getByText('미처리 신고')).toBeTruthy();
  expect(screen.queryByText('미처리 게임 신청')).toBeNull();
});

it('카운트 하나가 실패해도 나머지 줄은 보이고, 실패는 「건수 확인 실패」로 알린다', async () => {
  data.failReports = true;
  data.requests = [{ status: 'pending' }];
  data.rentals = [{ status: 'pending' }];
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await renderCard({ games: [], isOfficeOpen: false, onGoReports: vi.fn(), onGoRentalRequests: vi.fn() });
  expect(screen.getByText('외부 대여 신청')).toBeTruthy();
  expect(screen.getByText('미처리 게임 신청')).toBeTruthy();
  expect(screen.queryByText('미처리 신고')).toBeNull();
  expect(screen.getByText('건수 확인 실패')).toBeTruthy();
  expect(screen.getByText(/파손 신고/)).toBeTruthy();
  warn.mockRestore();
});

it('단체 연체(HOLD, 기한 다음 날부터)를 신청 단위로 반납 기한 지남에 합친다', async () => {
  const holdOverdue = { id: 5, name: '아컴호러', adminStatus: '대여가능', rentals: [
    { rental_id: 'h1', type: 'HOLD', request_id: 'req-1', due_date: kst('2026-10-10T23:59:59').toISOString(), returned_at: null },
    { rental_id: 'h2', type: 'HOLD', request_id: 'req-1', due_date: kst('2026-10-10T23:59:59').toISOString(), returned_at: null },
    { rental_id: 'h3', type: 'HOLD', request_id: 'req-2', due_date: kst('2026-10-12T23:59:59').toISOString(), returned_at: null }, // 오늘이 기한 — 아직 아님
  ] };
  await renderCard({ games: [overdueGame, holdOverdue], isOfficeOpen: false, onOpenWorkList: vi.fn() });
  expect(screen.getByText('반납 기한 지남')).toBeTruthy();
  expect(screen.getByText(/2건 \(단체 1\)/)).toBeTruthy();
});
