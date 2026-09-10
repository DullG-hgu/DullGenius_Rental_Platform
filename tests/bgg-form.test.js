import { describe, it, expect } from 'vitest';
import { formatPlayingTime } from '../src/admin/GameFormModal.jsx';

describe('formatPlayingTime (BGG 시간 → 표시 문자열)', () => {
  it('최소·최대가 같으면 단일 값', () => expect(formatPlayingTime(30, 30)).toBe('30분'));
  it('범위는 물결 표기', () => expect(formatPlayingTime(60, 120)).toBe('60~120분'));
  it('BGG 미기재(0)는 null', () => expect(formatPlayingTime(0, 0)).toBeNull());
  it('한쪽만 있으면 그 값', () => {
    expect(formatPlayingTime(0, 45)).toBe('45분');
    expect(formatPlayingTime(45, 0)).toBe('45분');
  });
  it('최소가 5분 미만이면 최대만 쓴다 (1~30분 방지)', () => expect(formatPlayingTime(1, 30)).toBe('30분'));
  it('null 입력도 안전', () => expect(formatPlayingTime(null, undefined)).toBeNull());
});
