import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GameDetail from '../src/components/GameDetail';
import { fetchGameById, fetchReviews, addReview, deleteReview } from '../src/api';
const state = vi.hoisted(() => ({ games: [], loading: false, error: null, refreshGames: vi.fn() }));
vi.mock('../src/contexts/GameDataContext', () => ({ useGameData: () => state }));
const auth = vi.hoisted(() => ({ user: null, profile: null, loading: false }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../src/api', () => ({ fetchGameById: vi.fn(), fetchReviews: vi.fn(), increaseViewCount: vi.fn(), sendLog: vi.fn(), sendMiss: vi.fn(), addReview: vi.fn(), updateReview: vi.fn(), deleteReview: vi.fn(), dibsGame: vi.fn(), cancelDibsGame: vi.fn() }));
vi.mock('../src/components/InfoModal', () => ({ default: () => null }));
const available = { id: 1, name: 'Current game', status: '대여가능', rentals: [], quantity: 1, available_count: 1 };
const App = () => <MemoryRouter initialEntries={[{ pathname: '/game/1', state: { game: { ...available, status: '대여중' } } }]}><Routes><Route path="/game/:id" element={<GameDetail />} /></Routes></MemoryRouter>;
beforeEach(() => {
  vi.resetAllMocks(); auth.user = null; window.scrollTo = vi.fn(); state.games = []; state.loading = false; state.error = null;
  fetchReviews.mockResolvedValue([]); fetchGameById.mockResolvedValue(null);
});
afterEach(cleanup);
it('follows refreshed shared inventory instead of route-state snapshots', async () => {
  state.games = [{ ...available, status: '대여중' }];
  const view = render(<App />);
  expect(screen.queryByText('⚡ 찜하기 (30분)')).toBeNull();
  state.games = [available]; view.rerender(<App />);
  expect(await screen.findByText('⚡ 찜하기 (30분)')).toBeTruthy();
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
