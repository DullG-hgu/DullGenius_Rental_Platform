import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReturnModal from '../src/kiosk/ReturnModal.jsx';

const mocks = vi.hoisted(() => ({ list: vi.fn(), returnRental: vi.fn(), toast: vi.fn() }));
vi.mock('../src/api', () => ({ kioskListActiveRentals: mocks.list, kioskReturn: mocks.returnRental, sendLog: vi.fn() }));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../src/lib/gamesRealtime', () => ({ subscribeToGameChanges: () => () => {} }));

describe('return reward feedback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.list.mockResolvedValue([1, 2].map(id => ({
            rental_id: `rental-${id}`, game_id: id, borrowed_at: '2026-09-01T00:00:00Z',
            profiles: { id: 'fixture-user', name: '테스트 회원' }, game: { name: `게임 ${id}` },
        })));
    });

    it.each([
        [[50, 0], '✅ 2개 반납 완료! 총 50P 지급되었습니다.'],
        [[0, 0], '✅ 2개 반납 완료!'],
        [[50, undefined], '✅ 2개 반납 완료!'],
    ])('reports only confirmed server reward totals (%j)', async (points, message) => {
        points.forEach(value => mocks.returnRental.mockResolvedValueOnce({ success: true, points_awarded: value }));
        render(<ReturnModal onClose={vi.fn()} />);
        fireEvent.click(await screen.findByRole('button', { name: /테스트 회원/ }));
        screen.getAllByRole('checkbox').forEach(checkbox => fireEvent.click(checkbox));
        fireEvent.click(screen.getByRole('button', { name: '선택한 2개 반납하기' }));
        fireEvent.click(screen.getByRole('button', { name: '✓ 확인' }));
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(message, { type: 'success' }));
        expect(mocks.returnRental).toHaveBeenCalledWith(1, 'fixture-user', 'rental-1');
    });
});
