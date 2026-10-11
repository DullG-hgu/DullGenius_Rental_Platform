import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const { calls, toast, showToast, state } = vi.hoisted(() => {
  const toast = [];
  // 실제 ToastContext 처럼 같은 함수를 돌려준다 — 렌더마다 새 함수면 load(useCallback 의존)가 무한 재실행된다
  return { calls: { reject: [], confirm: [], cancel: [], ret: [] }, toast, showToast: (m) => toast.push(m), state: { status: 'needs_review', pickupAt: '2026-10-20T06:00:00Z', retResult: { success: true, closed_holds: 1, overdue_days: 0 } } };
});

vi.mock('../src/api', () => ({
  fetchRentalRequests: () => Promise.resolve([{
    id: 'req1', requester_name: '행사팀', requester_phone: '010-0000-0000', status: state.status,
    submitted_at: '2026-10-10T03:00:00Z', requested_games_raw: '카탄', matched_game_ids: [1],
    pickup_at: state.pickupAt, duration_days: 3, rental_fee: 0, hold_rental_ids: [],
  }]),
  confirmRentalRequest: (...args) => { calls.confirm.push(args); return Promise.resolve({ data: { success: true }, error: null }); },
  rejectRentalRequest: (id, reason) => { calls.reject.push([id, reason]); return Promise.resolve({ data: { success: true }, error: null }); },
  cancelRentalRequest: (id, reason) => { calls.cancel.push([id, reason]); return Promise.resolve({ data: { success: true, closed_holds: 1 }, error: null }); },
  returnRentalRequest: (id) => { calls.ret.push(id); return Promise.resolve({ data: state.retResult, error: null }); },
}));
vi.mock('../src/contexts/GameDataContext', () => ({ useGameData: () => ({ games: [{ id: 1, name: '카탄' }] }) }));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }));

import RentalRequestsTab from '../src/admin/RentalRequestsTab';

const tap = (el) => {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
};

beforeEach(() => {
  state.status = 'needs_review'; state.pickupAt = '2026-10-20T06:00:00Z';
  state.retResult = { success: true, closed_holds: 1, overdue_days: 0 };
  Object.values(calls).forEach((a) => { a.length = 0; });
  toast.length = 0;
});

it('반려 사유 입력칸을 눌러도 검토 모달이 닫히지 않고, 사유와 함께 반려된다', async () => {
  await act(async () => { render(<RentalRequestsTab />); });
  fireEvent.click(screen.getByRole('button', { name: '검토·수정' }));
  expect(screen.getByRole('dialog', { name: '대여 신청 검토' })).toBeTruthy();

  fireEvent.click(within(screen.getByRole('dialog', { name: '대여 신청 검토' })).getByRole('button', { name: '반려' })); // 상태 필터 칩에도 「반려」가 있다
  const reason = screen.getByLabelText(/반려 사유/);
  tap(reason); // 예전엔 이 클릭이 오버레이까지 올라가 검토 모달째 닫혔다
  expect(screen.getByRole('dialog', { name: '대여 신청 검토' })).toBeTruthy();

  // 사유 없이 확정하면 막힌다
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '반려 확정' })); });
  expect(calls.reject).toEqual([]);

  fireEvent.change(reason, { target: { value: '요청 기간 중복' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '반려 확정' })); });
  expect(calls.reject).toEqual([['req1', '요청 기간 중복']]);
  expect(screen.queryByRole('dialog', { name: '대여 신청 검토' })).toBeNull();
});

it('오버레이를 누르면 닫히지만, 작성 중인 반려 사유가 있으면 닫히지 않는다', async () => {
  await act(async () => { render(<RentalRequestsTab />); });
  fireEvent.click(screen.getByRole('button', { name: '검토·수정' }));
  const overlay = screen.getByRole('dialog', { name: '대여 신청 검토' }).parentElement;

  fireEvent.click(within(screen.getByRole('dialog', { name: '대여 신청 검토' })).getByRole('button', { name: '반려' })); // 상태 필터 칩에도 「반려」가 있다
  fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: '작성 중' } });
  tap(overlay);
  expect(screen.getByRole('dialog', { name: '대여 신청 검토' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '반려 취소' }));
  tap(overlay);
  expect(screen.queryByRole('dialog', { name: '대여 신청 검토' })).toBeNull();
});

it('확정 건도 「검토·수정」으로 열려 「변경 저장」으로 재확정하고, 반려할 수 있다', async () => {
  state.status = 'manual_confirmed';
  await act(async () => { render(<RentalRequestsTab />); });
  // 확정 건은 관리자가 반납해야 끝나므로 기본 필터에 들어 있다
  fireEvent.click(screen.getByRole('button', { name: '검토·수정' }));
  const dialog = screen.getByRole('dialog', { name: '대여 신청 검토' });
  expect(within(dialog).getByText('확정 건 수정')).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: '승인 (HOLD 생성)' })).toBeNull();
  expect(within(dialog).getByRole('button', { name: '반려' })).toBeTruthy();

  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '변경 저장' })); });
  expect(calls.confirm).toHaveLength(1);
  expect(calls.confirm[0][0]).toBe('req1');
  expect(toast).toContain('변경 저장 완료');
});

it('확정 건 카드: 「반납」은 확인 후 신청 단위 반납, DB 거절 메시지는 그대로 토스트', async () => {
  state.status = 'manual_confirmed';
  state.retResult = { success: false, message: '수령 전 — 취소로 처리' };
  await act(async () => { render(<RentalRequestsTab />); });
  fireEvent.click(screen.getByRole('button', { name: '반납' }));
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: '단체 대여 반납' })).getByRole('button', { name: /반납/ })); });
  expect(calls.ret).toEqual(['req1']);
  expect(toast).toContain('수령 전 — 취소로 처리');
});

it('확정 건 카드: 「신청 취소」는 반려와 별개, 선택 사유를 함께 보낸다', async () => {
  state.status = 'auto_confirmed';
  await act(async () => { render(<RentalRequestsTab />); });
  fireEvent.click(screen.getByRole('button', { name: '신청 취소' }));
  const dialog = screen.getByRole('dialog', { name: '단체 대여 신청 취소' });
  fireEvent.change(within(dialog).getByPlaceholderText('예: 행사 취소'), { target: { value: '행사 무산' } });
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /신청 취소/ })); });
  expect(calls.cancel).toEqual([['req1', '행사 무산']]);
  expect(calls.reject).toEqual([]);
  expect(toast).toContain('신청 취소 완료');
});

it('반납 완료(returned) 카드에는 검토·반납·취소 버튼이 없다', async () => {
  state.status = 'returned';
  await act(async () => { render(<RentalRequestsTab />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '반납 완료' })); }); // 기본 필터에 없음 — 칩으로 켠다
  expect(screen.getByText('행사팀')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '검토·수정' })).toBeNull();
  expect(screen.queryByRole('button', { name: '반납' })).toBeNull();
  expect(screen.queryByRole('button', { name: '신청 취소' })).toBeNull();
});

it('수령 후 확정 건: 게임·수령일 잠금, 기간만 바꿔 원래 수령일 그대로 저장', async () => {
  state.status = 'manual_confirmed';
  state.pickupAt = '2026-10-01T06:00:00Z'; // 이미 지남
  await act(async () => { render(<RentalRequestsTab />); });
  fireEvent.click(screen.getByRole('button', { name: '검토·수정' }));
  const dialog = screen.getByRole('dialog', { name: '대여 신청 검토' });
  expect(within(dialog).getByText(/게임·수령일 변경 불가/)).toBeTruthy();
  expect(within(dialog).queryByPlaceholderText('게임 검색')).toBeNull();
  expect(within(dialog).getByLabelText('수령일시').disabled).toBe(true);
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '변경 저장' })); });
  expect(calls.confirm[0][1]).toEqual([1]);
  expect(new Date(calls.confirm[0][2]).getTime()).toBe(new Date('2026-10-01T06:00:00Z').getTime());
});
