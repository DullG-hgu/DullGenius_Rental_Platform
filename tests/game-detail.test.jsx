import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GameDetail from '../src/components/GameDetail';
import { fetchGameById, fetchReviews, addReview, deleteReview, fetchPaymentCheckEnabled, fetchDuesAccounts } from '../src/api';
const state = vi.hoisted(() => ({ games: [], loading: false, error: null, refreshGames: vi.fn() }));
vi.mock('../src/contexts/GameDataContext', () => ({ useGameData: () => state }));
const auth = vi.hoisted(() => ({ user: null, profile: null, loading: false }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../src/api', () => ({ fetchGameById: vi.fn(), fetchReviews: vi.fn(), increaseViewCount: vi.fn(), sendLog: vi.fn(), sendMiss: vi.fn(), addReview: vi.fn(), updateReview: vi.fn(), deleteReview: vi.fn(), dibsGame: vi.fn(), cancelDibsGame: vi.fn(), fetchPaymentCheckEnabled: vi.fn(), fetchDuesAccounts: vi.fn(async () => []) }));
vi.mock('../src/components/InfoModal', () => ({ default: () => null }));
const available = { id: 1, name: 'Current game', status: '대여가능', rentals: [], quantity: 1, available_count: 1 };
const App = () => <MemoryRouter initialEntries={[{ pathname: '/game/1', state: { game: { ...available, status: '대여중' } } }]}><Routes><Route path="/game/:id" element={<GameDetail />} /></Routes></MemoryRouter>;
beforeEach(() => {
  vi.resetAllMocks(); auth.user = null; auth.profile = null; auth.roles = []; auth.refreshProfile = vi.fn(); window.scrollTo = vi.fn(); state.games = []; state.loading = false; state.error = null;
  fetchReviews.mockResolvedValue([]); fetchGameById.mockResolvedValue(null); fetchPaymentCheckEnabled.mockResolvedValue(true); fetchDuesAccounts.mockResolvedValue([]);
});
afterEach(cleanup);
it('follows refreshed shared inventory instead of route-state snapshots', async () => {
  state.games = [{ ...available, status: '대여중' }];
  const view = render(<App />);
  expect(screen.queryByText('찜하기 (30분)')).toBeNull();
  state.games = [available]; view.rerender(<App />);
  expect(await screen.findByText('찜하기 (30분)')).toBeTruthy();
});
it('shows failure and retries a rejected detail request', async () => {
  fetchGameById.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(available);
  render(<App />);
  expect(await screen.findByText('게임 정보를 불러오지 못했습니다.')).toBeTruthy();
  fireEvent.click(screen.getByText('다시 시도'));
  expect(await screen.findByText('Current game')).toBeTruthy();
});
it('distinguishes missing games from network failures', async () => {
  render(<App />);
  expect(await screen.findByText('게임을 찾을 수 없습니다.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('does not let a review failure block the game and allows review retry', async () => {
  state.games = [available]; fetchReviews.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  render(<App />);
  expect(await screen.findByText('리뷰 다시 시도')).toBeTruthy();
  expect(screen.getByText('Current game')).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByText('리뷰 다시 시도')));
  expect(await screen.findByText('아직 리뷰가 없습니다. 첫 리뷰를 남겨주세요!')).toBeTruthy();
});

it('keeps a successful review insertion successful when the list refresh fails', async () => {
  state.games = [available]; auth.user = { id: 'member' };
  fetchReviews.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline'));
  addReview.mockResolvedValue({}); render(<App />);
  await screen.findByText('아직 리뷰가 없습니다. 첫 리뷰를 남겨주세요!');
  fireEvent.change(screen.getByPlaceholderText('후기를 남겨주세요'), { target: { value: 'Nice game' } });
  fireEvent.click(screen.getByRole('button', { name: '등록' }));
  await screen.findByText('리뷰 다시 시도');
  expect(addReview).toHaveBeenCalledOnce();
  expect(showToast.mock.calls.some(([text]) => text.includes('등록 실패'))).toBe(false);
  expect(screen.getByPlaceholderText('후기를 남겨주세요').value).toBe('');
});
it('keeps a successful review deletion successful when the list refresh fails', async () => {
  state.games = [available]; auth.user = { id: 'member' };
  fetchReviews.mockResolvedValueOnce([{ review_id: 5, user_id: 'member', content: 'My review', rating: 5, created_at: '2026-09-01' }]).mockRejectedValueOnce(new Error('offline'));
  deleteReview.mockResolvedValue({}); render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '삭제' }));
  fireEvent.click(screen.getByRole('button', { name: '✓ 확인' }));
  await screen.findByText('리뷰 다시 시도');
  expect(deleteReview).toHaveBeenCalledWith(5);
  expect(showToast.mock.calls.some(([text]) => text.includes('삭제 실패'))).toBe(false);
});
it('blocks dibs for an unpaid member while the dues check is on, and lets paid members through', async () => {
  state.games = [available]; auth.user = { id: 'member' }; auth.profile = { is_paid: false };
  const view = render(<App />);
  expect(await screen.findByText('회비 납부 후 대여 가능')).toBeTruthy();
  expect(screen.queryByText('찜하기 (30분)')).toBeNull();
  expect(await screen.findByText('납부 방법은 운영진에게 문의해 주세요.')).toBeTruthy();
  auth.profile = { is_paid: true }; view.rerender(<App />);
  expect(await screen.findByText('찜하기 (30분)')).toBeTruthy();
});
it('keeps dibs open for unpaid members during the free period (dues check off)', async () => {
  fetchPaymentCheckEnabled.mockResolvedValue(false);
  state.games = [available]; auth.user = { id: 'member' }; auth.profile = { is_paid: false };
  render(<App />);
  expect(await screen.findByText('찜하기 (30분)')).toBeTruthy();
  await act(async () => {});
  expect(screen.queryByText('회비 납부 후 대여 가능')).toBeNull();
});
it('replaces the dibs button with pickup directions and a countdown after dibs', async () => {
  const due = new Date(Date.now() + 20 * 60000).toISOString();
  auth.user = { id: 'member' }; auth.profile = { is_paid: true };
  state.games = [{ ...available, status: '찜', available_count: 0, rentals: [{ user_id: 'member', type: 'DIBS', due_date: due, returned_at: null }] }];
  render(<App />);
  expect(await screen.findByText('찜 완료')).toBeTruthy();
  expect(screen.getByText('수령 마감까지 20분')).toBeTruthy();
  expect(screen.getByText(/찜 수령하기/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '찜 취소' })).toBeTruthy();
});
it('tells when a rented-out game is due back', async () => {
  state.games = [{ ...available, status: '대여중', available_count: 0, rentals: [{ type: 'RENT', due_date: '2099-03-05T15:00:00Z', returned_at: null }] }];
  render(<App />);
  expect(await screen.findByText('반납 예정일은 3월 5일이에요.')).toBeTruthy();
});
it('shows the dues account from admin settings to a blocked member', async () => {
  fetchDuesAccounts.mockResolvedValue([{ bank: '시험은행', number: '000-0000', holder: '시험' }, { bank: '둘째은행', number: '111-1111', holder: '시험' }]);
  state.games = [available]; auth.user = { id: 'member' }; auth.profile = { is_paid: false };
  render(<App />);
  expect(await screen.findByText('시험은행 000-0000')).toBeTruthy();
  expect(screen.getByText('둘째은행 111-1111')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '계좌번호 복사' })).toHaveLength(2);
});
