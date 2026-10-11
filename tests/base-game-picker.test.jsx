import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BaseGamePicker from '../src/admin/BaseGamePicker.jsx';

const games = [
    { id: 1, name: '카탄', base_game_id: null },
    { id: 2, name: '카탄: 항해사', base_game_id: 1 },
    { id: 3, name: '정령섬', base_game_id: null },
];

describe('BaseGamePicker (게임 폼 본판 칸)', () => {
    it('연결된 확장판의 「연결 해제」는 null 로 바꾼다', () => {
        const onChange = vi.fn();
        render(<BaseGamePicker games={games} gameId={2} name="카탄: 항해사" baseGameId={1} onChange={onChange} />);
        expect(screen.getByText(/카탄의 확장판/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '연결 해제' }));
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('확장판이 딸린 본판은 다른 게임의 확장판으로 못 고른다', () => {
        render(<BaseGamePicker games={games} gameId={1} name="카탄" baseGameId={null} onChange={vi.fn()} />);
        expect(screen.getByText(/딸린 확장판 1개: 카탄: 항해사/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '본판 직접 찾기' })).toBeNull();
    });

    it('이름이 확장판처럼 보이면 본판 후보 칩 — 누르면 그 id', () => {
        const onChange = vi.fn();
        render(<BaseGamePicker games={games} name="정령섬: 가지와 발톱" baseGameId={null} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: '+ 정령섬' }));
        expect(onChange).toHaveBeenCalledWith(3);
    });

    it('직접 찾기 결과에 자기 자신과 확장판은 없다', () => {
        render(<BaseGamePicker games={games} gameId={3} name="정령섬" baseGameId={null} onChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: '본판 직접 찾기' }));
        fireEvent.change(screen.getByPlaceholderText('본판 이름 (초성 가능)'), { target: { value: 'ㅈ' } });
        expect(screen.getByText(/일치하는 본판 없음/)).toBeInTheDocument();
        fireEvent.change(screen.getByPlaceholderText('본판 이름 (초성 가능)'), { target: { value: '카탄' } });
        expect(screen.getByRole('button', { name: '카탄' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '카탄: 항해사' })).toBeNull();
    });
});

describe('BaseGamePicker — 목록 없음', () => {
    it('games 를 못 받으면 검색 대신 안내만 (폼은 그대로)', () => {
        render(<BaseGamePicker name="정령섬: 가지와 발톱" baseGameId={null} onChange={vi.fn()} />);
        expect(screen.getByText(/게임 목록 없음/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '본판 직접 찾기' })).toBeNull();
    });
});

describe('BaseGamePicker — 잘못 걸린 연결', () => {
    it('확장판이 딸린 본판에 본판 연결까지 걸려 있으면 해제할 수 있다', () => {
        const onChange = vi.fn();
        const chained = [
            { id: 1, name: '카탄', base_game_id: 3 },
            { id: 2, name: '카탄: 항해사', base_game_id: 1 },
            { id: 3, name: '정령섬', base_game_id: null },
        ];
        render(<BaseGamePicker games={chained} gameId={1} name="카탄" baseGameId={3} onChange={onChange} />);
        expect(screen.getByText(/정령섬」의 확장판으로도 연결됨/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '연결 해제' }));
        expect(onChange).toHaveBeenCalledWith(null);
    });
});

describe('BaseGamePicker — 로딩 중', () => {
    it('목록을 불러오는 중이면 「없음」 대신 불러오는 중 안내', () => {
        const { rerender } = render(<BaseGamePicker games={[]} gamesLoading name="정령섬: 가지와 발톱" baseGameId={null} onChange={vi.fn()} />);
        expect(screen.getByText('게임 목록 불러오는 중')).toBeInTheDocument();
        expect(screen.queryByText(/게임 목록 없음/)).toBeNull();
        rerender(<BaseGamePicker games={[]} gamesLoading={false} name="정령섬: 가지와 발톱" baseGameId={null} onChange={vi.fn()} />);
        expect(screen.getByText(/게임 목록 없음/)).toBeInTheDocument();
    });
});
