import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Login from '../src/components/Login';
import Signup from '../src/components/Signup';
import PasswordReset from '../src/components/PasswordReset';
import { getSafeReturnPath, stashPendingRoute, takePendingRoute } from '../src/lib/pendingRoute';

vi.mock('../src/contexts/AuthContext', () => ({
    useAuth: () => ({ login: vi.fn().mockResolvedValue({}), signup: vi.fn().mockResolvedValue({}) }),
}));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

function Destination() {
    const location = useLocation();
    return <output>{location.pathname + location.search}</output>;
}

function renderRoute(path) {
    render(<MemoryRouter initialEntries={[path]}><Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/reset-password" element={<PasswordReset />} />
        <Route path="*" element={<Destination />} />
    </Routes></MemoryRouter>);
}

describe('safe login return paths', () => {
    it.each(['/event/tournament/apply', '/event/team/ABC123', '/admin-secret/events/abc', '/game/1?from=search', '/play/me'])('preserves %s', path => {
        expect(getSafeReturnPath(path)).toBe(path);
    });
    it.each(['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/event/%2f%2fevil.invalid', 'javascript:alert(1)', '/login', '/signup', '/event/..\\evil'])('rejects %s', path => {
        expect(getSafeReturnPath(path)).toBeNull();
    });
    it('consumes stored admin return once and gives explicit safe event link precedence', () => {
        stashPendingRoute('/admin-secret');
        expect(takePendingRoute('/event/team/ABC')).toBe('/event/team/ABC');
        expect(takePendingRoute()).toBeNull();
    });
});

describe('login and recovery flow', () => {
    it('returns to the game detail when login was opened with router state', async () => {
        renderRoute({ pathname: '/login', state: { from: '/game/7' } });
        fireEvent.change(screen.getByLabelText('학번'), { target: { value: '00000000' } });
        fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'test-only' } });
        fireEvent.click(screen.getByRole('button', { name: '로그인' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('/game/7'));
    });
    it('returns to the event application after login', async () => {
        renderRoute('/login?redirect=%2Fevent%2Ftournament%2Fapply');
        fireEvent.change(screen.getByLabelText('학번'), { target: { value: '00000000' } });
        fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'test-only' } });
        fireEvent.click(screen.getByRole('button', { name: '로그인' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('/event/tournament/apply'));
    });
    it('keeps the event destination through the signup link and successful signup', async () => {
        renderRoute('/login?redirect=%2Fevent%2Fteam%2FABC');
        fireEvent.click(screen.getByRole('link', { name: '회원가입' }));
        fireEvent.change(screen.getByPlaceholderText('이름'), { target: { value: '진단용 회원' } });
        fireEvent.change(screen.getByPlaceholderText('학번 (8자리)'), { target: { value: '00000000' } });
        fireEvent.change(screen.getByPlaceholderText('비밀번호'), { target: { value: 'test-only' } });
        fireEvent.change(screen.getByPlaceholderText('전화번호'), { target: { value: '01000000000' } });
        fireEvent.click(screen.getByRole('button', { name: '가입하기' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('/event/team/ABC'));
    });
    it('offers assisted reset and preserves the return path without requesting email or password', () => {
        renderRoute('/reset-password?redirect=%2Fevent%2Fteam%2FABC');
        expect(screen.getByRole('link', { name: '운영진에게 초기화 요청하기' }).getAttribute('href')).toMatch(/^mailto:/);
        expect(screen.getByRole('link', { name: '로그인하기' })).toHaveAttribute('href', '/login?redirect=%2Fevent%2Fteam%2FABC');
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.getByText(/본인만 아는 비밀번호로/)).toBeInTheDocument();
    });
});
