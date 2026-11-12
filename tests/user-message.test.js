import { describe, expect, it, vi } from 'vitest';
import { userMessage } from '../src/lib/userMessage';
import { getAuthErrorMessage } from '../src/constants';

describe('오류 문구 — 서버 원문을 화면에 내보내지 않는다', () => {
  it('한글 안내는 그대로, 영문·빈 값은 대체 문구', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(userMessage(new Error('이미 리뷰를 작성했습니다.'), '대체')).toBe('이미 리뷰를 작성했습니다.');
    expect(userMessage(new Error('duplicate key value violates unique constraint'), '대체')).toBe('대체');
    expect(userMessage(new TypeError('Failed to fetch'), '대체')).toBe('대체');
    expect(userMessage(null, '대체')).toBe('대체');
    expect(userMessage('잠시 후 다시 시도해 주세요', '대체')).toBe('잠시 후 다시 시도해 주세요');
  });

  it('로그인·가입 오류도 모르는 영문은 감춘다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getAuthErrorMessage({ message: 'Invalid login credentials' })).toBe('학번 또는 비밀번호가 올바르지 않습니다.');
    expect(getAuthErrorMessage({ message: 'New password should be different from the old password.' })).toContain('다른 비밀번호');
    expect(getAuthErrorMessage(new TypeError('Failed to fetch'))).toContain('연결 상태');
    expect(getAuthErrorMessage({ message: 'unexpected_failure: db timeout' })).not.toMatch(/[a-z]{4,}/);
    expect(getAuthErrorMessage(null)).toBe('');
  });
});
