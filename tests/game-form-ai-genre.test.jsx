import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GameFormModal from '../src/admin/GameFormModal.jsx';

const mocks = vi.hoisted(() => ({ suggest: vi.fn(), fetchBGGGame: vi.fn(), toast: vi.fn() }));
vi.mock('../src/api', () => ({
    searchBGG: vi.fn().mockResolvedValue([]),
    fetchBGGGame: mocks.fetchBGGGame,
    searchKoreanImages: vi.fn().mockResolvedValue([]),
    checkGameExists: vi.fn().mockResolvedValue([]),
    suggestGenresAI: mocks.suggest,
}));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast }) }));

const open = (initialData) => render(
    <GameFormModal isOpen onClose={() => {}} onSubmit={() => {}} title="수정" initialData={initialData} />,
);
const genresInput = () => screen.getByPlaceholderText('예: 전략, 추리, 파티');

describe('관리자 게임 폼 — AI 장르 제안', () => {
    beforeEach(() => vi.clearAllMocks());

    it('BGG 연결 전에는 제안 버튼이 꺼져 있다', () => {
        open({ name: '카탄', genres: ['전략'] });
        expect(screen.getByRole('button', { name: /AI 장르 제안/ })).toBeDisabled();
        expect(screen.getByText('BGG를 연결하면 사용할 수 있어요')).toBeInTheDocument();
    });

    it('후보 칩을 누르면 장르에 추가되고, 이미 있는 장르는 추가 표시', async () => {
        mocks.suggest.mockResolvedValue({ available: true, suggestions: [{ genre: '협상', p: 0.96 }, { genre: '전략', p: 0.9 }] });
        open({ name: '카탄', bgg_id: '13', genres: ['전략'] });
        fireEvent.click(screen.getByRole('button', { name: /AI 장르 제안/ }));
        expect(mocks.suggest).toHaveBeenCalledWith('13', '카탄');
        const chip = await screen.findByRole('button', { name: /협상/ });
        expect(screen.getByRole('button', { name: /✓ 전략/ })).toBeDisabled();
        fireEvent.click(chip);
        expect(genresInput()).toHaveValue('전략, 협상');
    });

    it('크레딧 소진 등으로 못 쓰면 사유만 보이고 입력은 그대로', async () => {
        mocks.suggest.mockResolvedValue({ available: false, reason: 'quota' });
        open({ name: '카탄', bgg_id: '13', genres: ['전략'] });
        fireEvent.click(screen.getByRole('button', { name: /AI 장르 제안/ }));
        expect(await screen.findByText(/크레딧 소진/)).toBeInTheDocument();
        expect(genresInput()).toHaveValue('전략');
    });

    it('BGG 정보를 불러와도 운영자 장르를 영문 카테고리로 덮어쓰지 않는다', async () => {
        mocks.fetchBGGGame.mockResolvedValue({ id: '13', type: 'boardgame', genres: ['Negotiation', 'Economic'], mechanics: [], minPlayers: '3', maxPlayers: '4' });
        open({ name: '카탄', genres: ['전략', '협상'] });
        fireEvent.change(screen.getByLabelText('BGG ID 직접 입력'), { target: { value: '13' } });
        fireEvent.click(screen.getByRole('button', { name: '가져오기' }));
        await waitFor(() => expect(mocks.fetchBGGGame).toHaveBeenCalledWith('13'));
        expect(await screen.findByText(/BGG 카테고리\(참고\): Negotiation, Economic/)).toBeInTheDocument();
        expect(genresInput()).toHaveValue('전략, 협상');
    });
});
