import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '../src/components/Header';

const mocks = vi.hoisted(() => ({ auth: {}, updateState: {}, update: vi.fn() }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../src/hooks/useAppUpdate', () => ({
    default: () => ({ ...mocks.updateState, update: mocks.update }),
}));

const loggedIn = { user: { id: 'u1' }, profile: { name: '테스트' }, roles: [], logout: vi.fn(), loading: false };
const loggedOut = { user: null, profile: null, roles: [], logout: vi.fn(), loading: false };

const renderHeader = () => render(<MemoryRouter><Header /></MemoryRouter>);

describe('header update button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateState = { updateAvailable: false, updating: false };
    });

    it('새 빌드가 없으면 평소 버튼 그대로', () => {
        mocks.auth = loggedIn;
        renderHeader();
        expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '업데이트' })).toBeNull();
    });

    it('로그인 상태: 로그아웃 자리를 차지하고 마이페이지 입구는 남긴다', () => {
        mocks.auth = loggedIn;
        mocks.updateState = { updateAvailable: true, updating: false };
        renderHeader();
        expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull();
        expect(screen.getByRole('link', { name: '테스트님' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '업데이트' }));
        expect(mocks.update).toHaveBeenCalledTimes(1);
    });

    it('비로그인 상태: 회원가입 자리를 차지하고 로그인은 남긴다', () => {
        mocks.auth = loggedOut;
        mocks.updateState = { updateAvailable: true, updating: false };
        renderHeader();
        expect(screen.queryByRole('link', { name: '회원가입' })).toBeNull();
        expect(screen.getByRole('link', { name: '로그인' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '업데이트' })).toBeInTheDocument();
    });

    it('갱신 중에는 다시 누를 수 없다', () => {
        mocks.auth = loggedIn;
        mocks.updateState = { updateAvailable: true, updating: true };
        renderHeader();
        expect(screen.getByRole('button', { name: '업데이트 중' })).toBeDisabled();
    });
});
