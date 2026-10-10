import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// supabase-js 는 탭이 다시 보일 때마다 SIGNED_IN, 한 시간마다 TOKEN_REFRESHED 를 보낸다.
// 같은 사용자면 profiles·user_roles 를 다시 받지 않아야 한다 (2026-10-10)
const mocks = vi.hoisted(() => ({ emit: null, from: vi.fn() }));
vi.mock('../src/lib/supabaseClient', () => ({
    supabase: {
        auth: {
            onAuthStateChange: (callback) => {
                mocks.emit = callback;
                return { data: { subscription: { unsubscribe: () => {} } } };
            },
            signOut: vi.fn(async () => ({})),
        },
        from: mocks.from,
    },
}));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { AuthProvider, useAuth } from '../src/contexts/AuthContext';

const tables = { profiles: { id: 'u1', name: '부원' }, user_roles: [{ role_key: 'member' }] };
const builder = (table) => {
    const result = { data: tables[table], error: null };
    const chain = {
        select: () => chain,
        eq: () => (table === 'user_roles' ? Promise.resolve(result) : chain),
        single: () => Promise.resolve(result),
    };
    return chain;
};

function Probe() {
    const { profile, loading } = useAuth();
    return <span>{loading ? 'loading' : profile?.name ?? 'none'}</span>;
}

const session = (id) => ({ user: { id } });
const emit = async (event, s) => { await act(async () => { mocks.emit(event, s); }); };
const profileCalls = () => mocks.from.mock.calls.filter(([t]) => t === 'profiles').length;

beforeEach(() => {
    mocks.from.mockReset().mockImplementation(builder);
});
afterEach(cleanup);

it('does not refetch profile and roles when the same user returns to the tab or refreshes the token', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session('u1'));
    expect(screen.getByText('부원')).toBeTruthy();
    expect(profileCalls()).toBe(1);

    await emit('SIGNED_IN', session('u1'));
    await emit('TOKEN_REFRESHED', session('u1'));
    expect(profileCalls()).toBe(1);
});

it('still refetches on a user update, a different account, or after signing out and back in', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session('u1'));
    await emit('USER_UPDATED', session('u1'));
    expect(profileCalls()).toBe(2);

    await emit('SIGNED_IN', session('u2'));
    expect(profileCalls()).toBe(3);

    await emit('SIGNED_OUT', null);
    expect(screen.getByText('none')).toBeTruthy();
    await emit('SIGNED_IN', session('u2'));
    expect(profileCalls()).toBe(4);
});

it('retries on the next tab return if the first load failed', async () => {
    mocks.from.mockImplementation((table) => {
        if (table !== 'profiles') return builder(table);
        const chain = { select: () => chain, eq: () => chain, single: () => Promise.resolve({ data: null, error: { code: 'X', message: 'boom' } }) };
        return chain;
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await emit('INITIAL_SESSION', session('u1'));
    mocks.from.mockImplementation(builder);
    await emit('SIGNED_IN', session('u1'));
    expect(profileCalls()).toBe(2);
    expect(screen.getByText('부원')).toBeTruthy();
});
