import { describe, expect, it } from 'vitest';
import { baseGameCandidates, expansionsOf, looksLikeExpansion, suggestBaseGame } from '../src/admin/baseGame';

const games = [
    { id: 1, name: '카탄', base_game_id: null },
    { id: 2, name: '카탄: 항해사', base_game_id: 1 },
    { id: 3, name: '정령섬', base_game_id: null },
    { id: 4, name: '카탄 주니어', base_game_id: null },
    { id: 5, name: '타임 스토리즈', base_game_id: null },
];

describe('baseGameCandidates', () => {
    it('자기 자신과 확장판은 본판 후보가 아니다 (확장판의 확장판 방지)', () => {
        const ids = baseGameCandidates(games, 1).map((g) => g.id);
        expect(ids).not.toContain(1);
        expect(ids).not.toContain(2);
        expect(ids).toEqual([3, 4, 5]);
    });
    it('id 문자열·숫자 차이에도 자기 자신을 뺀다', () => {
        expect(baseGameCandidates(games, '3').map((g) => g.id)).not.toContain(3);
    });
    it('새 게임(id 없음)은 본판 전체가 후보', () => {
        expect(baseGameCandidates(games, undefined)).toHaveLength(4);
    });
});

describe('expansionsOf', () => {
    it('딸린 확장판 목록', () => {
        expect(expansionsOf(games, 1).map((g) => g.id)).toEqual([2]);
        expect(expansionsOf(games, '1').map((g) => g.id)).toEqual([2]);
        expect(expansionsOf(games, 3)).toEqual([]);
        expect(expansionsOf(games, undefined)).toEqual([]);
    });
});

describe('suggestBaseGame', () => {
    it('이름 앞부분이 본판 이름이면 제안 — 가장 긴 이름 우선', () => {
        expect(suggestBaseGame(games, { name: '카탄 주니어: 확장' })?.id).toBe(4);
        expect(suggestBaseGame(games, { name: '카탄: 상인과 야만인' })?.id).toBe(1);
        expect(suggestBaseGame(games, { name: '정령섬: 가지와 발톱' })?.id).toBe(3);
    });
    it('같은 이름·관계없는 이름·자기 자신은 제안하지 않는다', () => {
        expect(suggestBaseGame(games, { name: '카탄' })).toBeNull();
        expect(suggestBaseGame(games, { name: '스플렌더 확장' })).toBeNull();
        expect(suggestBaseGame(games, { id: 4, name: '카탄 주니어 2' })).toBeNull(); // 공백만으론 부제가 아니다
    });
    it('이미 확장판인 게임은 본판으로 제안하지 않는다', () => {
        expect(suggestBaseGame(games, { name: '카탄: 항해사 5-6인' })?.id).toBe(1);
    });
});

describe('looksLikeExpansion', () => {
    it.each([
        ['정령섬: 가지와 발톱', true],
        ['카탄 확장', true],
        ['Wingspan Expansion', true],
        ['카탄', false],
        ['', false],
    ])('%s → %s', (name, expected) => {
        expect(looksLikeExpansion(name)).toBe(expected);
    });
});

describe('suggestBaseGame — 검증 반례 (2026-10-11)', () => {
    const more = [
        { id: 10, name: 'Go', category: '보드게임', base_game_id: null },
        { id: 11, name: '타임 스토리즈', category: '머더미스터리', base_game_id: null },
        { id: 12, name: '카탄', category: '보드게임', base_game_id: null },
    ];
    it('본판 이름 뒤가 단어 경계가 아니면 제안하지 않는다 (Go ↛ Golem)', () => {
        expect(suggestBaseGame(more, { name: 'Golem: Expansion' })).toBeNull();
        expect(suggestBaseGame(more, { name: 'Go: 확장' })?.id).toBe(10);
        expect(suggestBaseGame(more, { name: '카탄확장' })?.id).toBe(12);
    });
    it('카테고리가 다르면 제안하지 않는다', () => {
        expect(suggestBaseGame(more, { name: '타임 스토리즈: 마리 사건', category: '보드게임' })).toBeNull();
        expect(suggestBaseGame(more, { name: '타임 스토리즈: 마리 사건', category: '머더미스터리' })?.id).toBe(11);
    });
    it('공백만 있는 이어지는 이름은 본판으로 보지 않는다 (The ↛ The Resistance: Avalon)', () => {
        const withThe = [...more, { id: 13, name: 'The', category: '보드게임', base_game_id: null }];
        expect(suggestBaseGame(withThe, { name: 'The Resistance: Avalon' })).toBeNull();
        expect(suggestBaseGame(more, { name: '카탄 확장: 바다' })?.id).toBe(12);
        expect(suggestBaseGame(more, { name: '카탄 - 5-6인' })?.id).toBe(12);
    });
    it('본판 이름 뒤에 구두점만 있으면 같은 게임으로 보고 제안하지 않는다', () => {
        expect(suggestBaseGame(more, { name: '카탄!' })).toBeNull();
    });
});
