import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

    // 결과는 토스트가 아니라 모달 안 결과 카드로 보여준다 (토스트가 모달 뒤에 가려졌다 — 2026-10-04)
    it.each([
        [[50, 0], '🎁 50P 지급'],
        [[0, 0], null],
        [[50, undefined], null],
    ])('reports only confirmed server reward totals (%j)', async (points, detail) => {
        points.forEach(value => mocks.returnRental.mockResolvedValueOnce({ success: true, points_awarded: value }));
        render(<ReturnModal onClose={vi.fn()} />);
        fireEvent.click(await screen.findByRole('button', { name: /테스트 회원/ }));
        screen.getAllByRole('checkbox').forEach(checkbox => fireEvent.click(checkbox));
        fireEvent.click(screen.getByRole('button', { name: '선택한 2개 반납하기' }));
        fireEvent.click(screen.getByRole('button', { name: '✓ 확인' }));
        expect(await screen.findByText('2개 반납 완료!')).toBeInTheDocument();
        if (detail) expect(screen.getByText(detail)).toBeInTheDocument();
        else expect(screen.queryByText(/P 지급/)).toBeNull();
        expect(mocks.returnRental).toHaveBeenCalledWith(1, 'fixture-user', 'rental-1');
    });
});
