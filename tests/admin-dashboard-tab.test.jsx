import React from 'react';
import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../src/api', () => ({
  adminUpdateGame: vi.fn(), deleteGame: vi.fn(), approveDibsByRenter: vi.fn(), returnGamesByRenter: vi.fn(),
  extendRentalsByRenter: vi.fn(), fetchGameLogs: vi.fn(), fetchAllLogs: vi.fn(() => Promise.resolve([])), fetchUsers: vi.fn(() => Promise.resolve([])),
  adminCancelDibs: vi.fn(), markGameLost: vi.fn(),
  returnRentalRequest: vi.fn(() => Promise.resolve({ data: { success: true, closed_holds: 2, overdue_days: 1 }, error: null })),
}));
vi.mock('../src/admin/saveGameEdit', () => ({ saveGameEdit: vi.fn() }));
vi.mock('../src/admin/GameFormModal', () => ({ default: () => null }));
const showToast = vi.fn();
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }));

import DashboardTab from '../src/admin/DashboardTab';

const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const games = [
  { id: 1, name: '카탄', category: '전략', status: '대여가능', adminStatus: '대여가능', available_count: 1, quantity: 1, rentals: [] },
  { id: 2, name: '스플렌더', category: '가족', status: '대여중', adminStatus: '대여중', available_count: 0, quantity: 1, dueDate: past,
    rentals: [{ rental_id: 'r1', type: 'RENT', user_id: 'u1', renter_name: '김민수', due_date: past, returned_at: null }] },
  { id: 3, name: '아줄', category: '가족', status: '예약됨', adminStatus: '예약됨', available_count: 0, quantity: 1,
    rentals: [{ rental_id: 'd1', type: 'DIBS', user_id: 'u2', renter_name: '박찜', returned_at: null }] },
];
const names = () => ['카탄', '스플렌더', '아줄'].filter((n) => screen.queryByText(n));
const renderTab = (props = {}) => render(<DashboardTab games={games} loading={false} onReload={vi.fn()} users={[]} {...props} />);

it('상태 칩: 한 번에 하나, 대여중·찜·연체·대여가능으로 목록을 좁힌다', () => {
  renderTab();
  expect(screen.getByRole('button', { name: '전체' }).getAttribute('aria-pressed')).toBe('true');
  expect(names()).toEqual(['카탄', '스플렌더', '아줄']);

  fireEvent.click(screen.getByRole('button', { name: '대여중' }));
  expect(names()).toEqual(['스플렌더']);
  fireEvent.click(screen.getByRole('button', { name: '찜' }));
  expect(names()).toEqual(['아줄']);
  fireEvent.click(screen.getByRole('button', { name: '연체 1' }));
  expect(names()).toEqual(['스플렌더']);
  fireEvent.click(screen.getByRole('button', { name: '대여가능' }));
  expect(names()).toEqual(['카탄']);
  expect(screen.getByRole('button', { name: '연체 1' }).getAttribute('aria-pressed')).toBe('false');
});

it('PC 「대여 가능만」 체크박스와 대여가능 칩은 같은 값을 본다', () => {
  renderTab();
  fireEvent.click(screen.getByLabelText('대여 가능만'));
  expect(screen.getByRole('button', { name: '대여가능' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '전체' }));
  expect(screen.getByLabelText('대여 가능만').checked).toBe(false);
});

it('검색은 관리자 쪽 입력 하나(FilterBar 검색 숨김), ↻ 은 재조회, 「이력」은 전체 이력', () => {
  const onReload = vi.fn();
  renderTab({ onReload });
  expect(screen.getAllByLabelText('게임 이름 또는 태그 검색')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
  expect(onReload).toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: '게임 관리 (3)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '이력' }));
  expect(screen.getByText(/\[전체\] 대여 이력/)).toBeTruthy();
});

it('대여자별 처리는 본문에 없고, workListOpen 일 때만 모달로 뜬다', () => {
  const { rerender } = renderTab();
  expect(screen.queryByLabelText('대여자 검색')).toBeNull();
  rerender(<DashboardTab games={games} loading={false} onReload={vi.fn()} users={[]} workListOpen onCloseWorkList={vi.fn()} />);
  expect(screen.getByRole('dialog', { name: /대여자별 처리/ })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '연체 1' }).find((b) => b.closest('[role="dialog"]')).getAttribute('aria-pressed')).toBe('true');
});

it('처음 사용 안내는 탭 맨 아래', () => {
  renderTab();
  expect(screen.getByText(/처음 사용하시나요/)).toBeTruthy();
});

it('PC 상세 필터가 걸려 있으면 (폰용) 「상세 필터 해제」 칩이 생기고 누르면 풀린다', () => {
  renderTab();
  expect(screen.queryByRole('button', { name: '상세 필터 해제' })).toBeNull();
  fireEvent.change(screen.getByLabelText('난이도 선택'), { target: { value: '전략' } });
  fireEvent.click(screen.getByRole('button', { name: '상세 필터 해제' }));
  expect(screen.getByLabelText('난이도 선택').value).toBe('전체');
  expect(screen.queryByRole('button', { name: '상세 필터 해제' })).toBeNull();
});

it('폰 접힘 한 줄: [검색][필터 N][↻] — 토글은 펼침 상태와 적용 필터 수를 보여 준다', () => {
  renderTab();
  const search = screen.getByLabelText('게임 이름 또는 태그 검색');
  const toggle = screen.getByRole('button', { name: /필터 펼치기/ });
  const reload = screen.getByRole('button', { name: '새로고침' });
  expect(search.parentElement).toBe(toggle.parentElement); // 같은 줄
  expect(reload.parentElement).toBe(toggle.parentElement);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  const chips = document.getElementById('admin-games-filters');
  expect(chips.className).not.toContain('is-open');

  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(chips.className).toContain('is-open');

  fireEvent.click(screen.getByRole('button', { name: '대여중' }));
  expect(screen.getByRole('button', { name: /필터 접기 \(적용 1개\)/ }).textContent).toContain('필터 1');
});

it('HOLD 행 「단체 반납」: 같은 신청 게임을 묶어 확인 후 request_id 로 반납', async () => {
  const api = await import('../src/api');
  const hold = (id, gameId) => ({ rental_id: id, game_id: gameId, type: 'HOLD', user_id: null, renter_name: '행사팀', request_id: 'req-9', due_date: past, returned_at: null });
  const holdGames = [
    { id: 11, name: '아컴호러', status: '대여가능', adminStatus: '대여가능', available_count: 0, quantity: 2,
      rentals: [hold('h1', 11), { rental_id: 'r9', type: 'RENT', user_id: 'u9', renter_name: '이회원', due_date: past, returned_at: null }] },
    { id: 12, name: '글룸헤이븐', status: '대여가능', adminStatus: '대여가능', available_count: 0, quantity: 1, rentals: [hold('h2', 12)] },
  ];
  const onReload = vi.fn();
  render(<DashboardTab games={holdGames} loading={false} onReload={onReload} users={[]} />);
  fireEvent.click(screen.getByRole('button', { name: '단체 반납' })); // RentalInstanceList (다중 대여 카드)
  expect(screen.getByText(/게임 2개를 한 번에 반납/)).toBeTruthy();
  const dialog = screen.getByText(/게임 2개를 한 번에 반납/).closest('[role="dialog"]');
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /확인/ })); });
  expect(api.returnRentalRequest).toHaveBeenCalledWith('req-9');
  expect(showToast).toHaveBeenCalledWith('반납 완료 — 단체 연체 1일', { type: 'success' });
  expect(onReload).toHaveBeenCalled();
});
