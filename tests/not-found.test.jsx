import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import NotFound from '../src/components/NotFound';
import EventPage from '../src/event/EventPage';
import EventApplyPage from '../src/event/EventApplyPage';
import EventTeamJoinPage from '../src/event/EventTeamJoinPage';
import EventDetailPage from '../src/admin/events/EventDetailPage';

const mocks = vi.hoisted(() => ({
  getEventBySlug: vi.fn(), getTeamByInviteCode: vi.fn(), getEvent: vi.fn(),
  maybeSingle: vi.fn(), showToast: vi.fn(),
  user: { id: 'test-member' },
}));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, profile: {}, loading: false, hasRole: () => true }) }));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../src/event/api_events_public', () => ({
  getEventBySlug: mocks.getEventBySlug, getTeamByInviteCode: mocks.getTeamByInviteCode,
  getMyRegistration: vi.fn().mockResolvedValue(null), getEventCounts: vi.fn().mockResolvedValue({ total: 0 }),
  getRegistration: vi.fn(), joinTeamByCode: vi.fn(), registerIndividual: vi.fn(), createTeam: vi.fn(),
}));
vi.mock('../src/admin/events/api_events', () => ({ getEvent: mocks.getEvent, listRegistrations: vi.fn(), listEventTeams: vi.fn() }));
vi.mock('../src/admin/events/EventInfoForm', () => ({ default: () => <p>행사 편집 폼</p> }));
vi.mock('../src/admin/events/EventRegistrationsView', () => ({ default: () => null }));
vi.mock('../src/admin/events/EventPaymentReconcile', () => ({ default: () => null }));
vi.mock('../src/admin/events/EventCheckInView', () => ({ default: () => null }));
vi.mock('../src/admin/events/EventCsvExport', () => ({ default: () => null }));
vi.mock('../src/lib/supabaseClient.jsx', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) } }));

function show(path) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/" element={<p>홈 도착</p>} />
    <Route path="/event/:slug" element={<EventPage />} />
    <Route path="/event/:slug/apply" element={<EventApplyPage />} />
    <Route path="/event/team/:code" element={<EventTeamJoinPage />} />
    <Route path="/admin-secret/events/:id" element={<EventDetailPage />} />
    <Route path="*" element={<NotFound />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEventBySlug.mockReset().mockResolvedValue(null);
  mocks.getTeamByInviteCode.mockReset().mockResolvedValue(null);
  mocks.getEvent.mockReset().mockRejectedValue({ code: 'PGRST116' });
  mocks.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
it('offers an explicit way home from an unknown URL', () => {
  show('/unknown/nested');
  expect(screen.getByRole('heading', { name: '페이지를 찾을 수 없습니다.' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '게임 검색' })).toHaveAttribute('href', '/search');
  fireEvent.click(screen.getByRole('link', { name: '홈으로 가기' }));
  expect(screen.getByText('홈 도착')).toBeInTheDocument();
});
it.each(['/event/missing', '/event/missing/apply'])('keeps missing event guidance at %s', async path => {
  show(path);
  expect(await screen.findByRole('heading', { name: '행사를 찾을 수 없습니다.' })).toBeInTheDocument();
  expect(screen.queryByText('홈 도착')).not.toBeInTheDocument();
});
it.each(['/event/missing', '/event/missing/apply'])('distinguishes a request error and retries at %s', async path => {
  mocks.getEventBySlug.mockRejectedValueOnce(new Error('offline'));
  show(path);
  expect(await screen.findByRole('alert')).toHaveTextContent('행사를 불러오지 못했습니다.');
  expect(screen.queryByText('404')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('404')).toBeInTheDocument();
  expect(mocks.getEventBySlug).toHaveBeenCalledTimes(2);
});
it('handles an unknown invitation', async () => {
  show('/event/team/missing');
  expect(await screen.findByRole('heading', { name: '초대 링크를 사용할 수 없습니다.' })).toBeInTheDocument();
});
it('handles a team whose event cannot be found', async () => {
  mocks.getTeamByInviteCode.mockResolvedValue({ event_id: 'event', team_name: 'team' });
  show('/event/team/code');
  expect(await screen.findByText('404')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /합류/ })).not.toBeInTheDocument();
});
it('retries an invitation lookup failure without presenting it as a 404', async () => {
  mocks.getTeamByInviteCode.mockRejectedValueOnce(new Error('offline'));
  show('/event/team/code');
  expect(await screen.findByRole('alert')).toHaveTextContent('초대 정보를 불러오지 못했습니다.');
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('404')).toBeInTheDocument();
});
it('offers the admin event list for a missing event', async () => {
  show('/admin-secret/events/missing');
  expect(await screen.findByText('404')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '행사 목록으로' })).toHaveAttribute('href', '/admin-secret/events');
});
it('recovers an admin lookup after a network failure', async () => {
  mocks.getEvent.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'event', title: '복구된 행사' });
  show('/admin-secret/events/event');
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('행사 편집 폼')).toBeInTheDocument();
});
