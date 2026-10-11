import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GameFormModal from '../src/admin/GameFormModal.jsx';

const mocks = vi.hoisted(() => ({ searchBGG: vi.fn() }));
vi.mock('../src/api', () => ({
    searchBGG: mocks.searchBGG,
    fetchBGGGame: vi.fn(),
    searchKoreanImages: vi.fn().mockResolvedValue([]),
    checkGameExists: vi.fn().mockResolvedValue([]),
    suggestGenresAI: vi.fn(),
}));
vi.mock('../src/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const open = (initialData) => render(
    <GameFormModal isOpen onClose={() => {}} onSubmit={() => {}} title="📝 새 게임 추가" initialData={initialData} />,
);

describe('게임 폼 — BGG 패널 위치 (모바일 2026-10-12)', () => {
    beforeEach(() => {
        mocks.searchBGG.mockResolvedValue([]);
    });

    it('BGG 후보가 많으면 처음엔 6개만, 「더 보기」로 전부 (폼이 한참 아래로 밀리지 않게)', async () => {
        mocks.searchBGG.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: String(100 + i), name: `카탄 후보 ${i}`, year: 2000 + i })));
        open({ name: '카탄' });
        expect(await screen.findByText('카탄 후보 0')).toBeInTheDocument();
        expect(screen.getByText('카탄 후보 5')).toBeInTheDocument();
        expect(screen.queryByText('카탄 후보 6')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '후보 4개 더 보기' }));
        expect(screen.getByText('카탄 후보 9')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull();
    });

    it('BGG 패널이 폼보다 먼저 온다 (화면 순서 = 탭 순서)', () => {
        open({ name: '카탄' });
        const bgg = screen.getByRole('heading', { name: 'BGG 검색 결과' });
        const formTitle = screen.getByRole('heading', { name: '📝 새 게임 추가' });
        expect(bgg.compareDocumentPosition(formTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('이름이 비어 있으면 BGG 패널에 입력 안내, 있으면 숨김', () => {
        const { unmount } = open({ name: '' });
        expect(screen.getByText(/「이름」 칸에 게임 이름 입력 시 자동 검색/)).toBeInTheDocument();
        unmount();
        open({ name: '카탄' });
        expect(screen.queryByText(/「이름」 칸에 게임 이름 입력 시 자동 검색/)).toBeNull();
    });

    it('모바일 CSS 가 order 로 BGG 패널을 폼 아래로 다시 뒤집지 않는다', () => {
        const css = readFileSync(resolve(process.cwd(), 'src/Admin.css'), 'utf8');
        const rule = (selector) => {
            const i = css.indexOf(`  .admin-container ${selector} {`, css.indexOf('@media (max-width: 800px)'));
            expect(i).toBeGreaterThan(-1); // 선택자를 못 찾으면 통과로 넘어가지 않게
            return css.slice(i, css.indexOf('}', i));
        };
        expect(rule('.game-bgg-side-modal')).not.toMatch(/order\s*:/);
        expect(rule('.game-form-modal')).not.toMatch(/order\s*:/);
    });
});
