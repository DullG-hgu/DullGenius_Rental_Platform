import { describe, expect, it } from 'vitest';
import { rentalDDayLabel, rentalDueDays } from '../src/lib/rentalDue';

// KST 시각 → Date (테스트 실행 환경 타임존과 무관)
const kst = (s) => new Date(`${s}+09:00`);

describe('rentalDDayLabel (KST 달력 기준)', () => {
  // 10/10 키오스크 수령 → rental_due_date() = 10/12 00:00 KST (= 10/11 밤 12시)
  const kioskDue = kst('2026-10-12T00:00:00').toISOString();

  it.each([
    ['2026-10-10T15:00:00', '반납까지 D-1'], // 수령 당일
    ['2026-10-11T09:00:00', '오늘 반납'], // 예전엔 D-1 로 보였다
    ['2026-10-11T23:59:58', '오늘 반납'],
    ['2026-10-12T00:30:00', '연체 1일'], // 예전엔 「오늘 반납」으로 보였다
    ['2026-10-13T10:00:00', '연체 2일'],
  ])('키오스크 마감, 지금 %s → %s', (now, expected) => {
    expect(rentalDDayLabel(kioskDue, kst(now))).toBe(expected);
  });

  it('연장 마감(23:59:59 KST)은 그날이 반납일', () => {
    const due = kst('2026-10-18T23:59:59').toISOString();
    expect(rentalDDayLabel(due, kst('2026-10-18T08:00:00'))).toBe('오늘 반납');
    expect(rentalDDayLabel(due, kst('2026-10-11T08:00:00'))).toBe('반납까지 D-7');
  });

  it('7×24시간 마감은 그 시각을 넘기면 같은 날이어도 연체', () => {
    const due = kst('2026-10-18T14:23:00').toISOString();
    expect(rentalDDayLabel(due, kst('2026-10-18T14:00:00'))).toBe('오늘 반납');
    expect(rentalDDayLabel(due, kst('2026-10-18T15:00:00'))).toBe('연체 1일');
  });

  it('밀리초가 붙은 마감이 자정 직후여도 음수 D-Day가 나오지 않는다', () => {
    const due = kst('2026-10-12T00:00:00.500').toISOString();
    expect(rentalDDayLabel(due, kst('2026-10-12T00:00:00.250'))).toBe('오늘 반납');
    expect(rentalDDayLabel(due, kst('2026-10-11T12:00:00'))).toBe('반납까지 D-1');
  });

  it('마감 시각 그 순간부터 연체', () => {
    expect(rentalDDayLabel(kioskDue, kst('2026-10-12T00:00:00'))).toBe('연체 1일');
  });

  it('잘못된 값은 -', () => {
    expect(rentalDDayLabel('not-a-date')).toBe('-');
    expect(rentalDueDays('not-a-date')).toBeNull();
  });
});
