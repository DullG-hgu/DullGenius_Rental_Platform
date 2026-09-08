import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SystemTab from '../src/admin/SystemTab';
import { resetSemesterPayments } from '../src/api_members';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), fetchUsers: vi.fn(), toast: vi.fn() }));
vi.mock('../src/lib/supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../src/api', () => ({ fetchUsers: mocks.fetchUsers }));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../src/components/ConfirmModal', () => ({
    default: ({ isOpen, onConfirm, onClose }) => isOpen ? (
        <button onClick={() => { onConfirm(); onClose(); }}>초기화 확인</button>
    ) : null,
}));

const oldUsers = [{ id: 'member', is_paid: true }, { id: 'exempt', is_paid: true }];
const freshUsers = [{ id: 'member', is_paid: false }, { id: 'exempt', is_paid: true }];
const confirmReset = async () => {
    const button = screen.getByRole('button', { name: '🔄 학기 종료 - 회비 일괄 초기화' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(screen.getByText('초기화 확인'));
};

beforeEach(() => {
    vi.resetAllMocks();
    mocks.rpc.mockResolvedValue({ data: { success: true, reset_count: 1 }, error: null });
    mocks.fetchUsers.mockResolvedValue(freshUsers);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

it('refreshes parent member data and displayed counts even while old props remain', async () => {
    const reload = vi.fn().mockResolvedValue(freshUsers);
    render(<SystemTab users={oldUsers} onUsersReload={reload} />);
    await confirmReset();
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText('회비 납부').parentElement).toHaveTextContent('1'));
    expect(screen.getByText('회비 미납').parentElement).toHaveTextContent('1');
    expect(mocks.rpc).toHaveBeenCalledWith('reset_semester_payments');
    expect(mocks.fetchUsers).not.toHaveBeenCalled();
});

it('fetches fresh members when used without a parent reload callback', async () => {
    render(<SystemTab users={oldUsers} />);
    await confirmReset();
    await waitFor(() => expect(mocks.fetchUsers).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText('회비 납부').parentElement).toHaveTextContent('1'));
});

it('reports a server refusal without a success toast or member reload', async () => {
    mocks.rpc.mockResolvedValue({ data: { success: false, message: '관리자 권한이 필요합니다.' }, error: null });
    const reload = vi.fn();
    render(<SystemTab users={oldUsers} onUsersReload={reload} />);
    await confirmReset();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('초기화 실패: 관리자 권한이 필요합니다.', { type: 'error' }));
    expect(reload).not.toHaveBeenCalled();
    expect(mocks.toast.mock.calls.some(([, options]) => options.type === 'success')).toBe(false);
});

it('distinguishes a failed refresh from a failed reset and blocks another reset while refreshing', async () => {
    let rejectRefresh;
    const reload = vi.fn(() => new Promise((resolve, reject) => { rejectRefresh = reject; }));
    render(<SystemTab users={oldUsers} onUsersReload={reload} />);
    await confirmReset();
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: '초기화 처리 중…' })).toBeDisabled();
    rejectRefresh(new Error('offline'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('초기화는 완료됐지만'), { type: 'warning' }));
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.toast.mock.calls.some(([, options]) => options.type === 'error')).toBe(false);
});

it.each([null, { success: true }, { success: true, reset_count: -1 }])('rejects malformed results (%j)', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(resetSemesterPayments()).rejects.toThrow();
});

it('preserves transport failures', async () => {
    const error = new Error('offline');
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(resetSemesterPayments()).rejects.toBe(error);
});
