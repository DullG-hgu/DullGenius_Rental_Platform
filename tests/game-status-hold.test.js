import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateGameStatus } from '../src/lib/gameStatus';
import { holdOverdueDays } from '../src/lib/rentalDue';

// KST 시각 → Date (테스트 실행 환경 타임존과 무관)
const kst = (s) => new Date(`${s}+09:00`);

// 10/20 14:00 수령, 3일 대여 → borrowed_at = 수령 24시간 전, due = 수령 + 3일
const hold = (over = {}) => ({
  rental_id: 'h1', type: 'HOLD', user_id: null, renter_name: '행사팀', returned_at: null,
  borrowed_at: kst('2026-10-19T14:00:00').toISOString(),
  due_date: kst('2026-10-23T14:00:00').toISOString(),
  ...over,
});
const game = { id: 1, quantity: 1, is_rentable: true };

const at = (s) => vi.setSystemTime(kst(s));

describe('calculateGameStatus — 단체대여(HOLD)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('수령 8일보다 전이면 점유하지 않는다', () => {
    at('2026-10-10T12:00:00');
    expect(calculateGameStatus(game, [hold()]).status).toBe('대여가능');
  });

  it('선행 창 안, 수령일 전이면 「예약됨」', () => {
    at('2026-10-19T20:00:00'); // borrowed_at 은 지났지만 아직 수령 전날
    const s = calculateGameStatus(game, [hold()]);
    expect(s.status).toBe('예약됨');
    expect(s.adminStatus).toBe('예약됨');
    expect(s.available_count).toBe(0);
  });

  it('수령일(KST) 00:00 부터 「대여중」', () => {
    at('2026-10-20T00:00:00');
    const s = calculateGameStatus(game, [hold()]);
    expect(s.status).toBe('대여중');
    expect(s.adminStatus).toBe('대여중');
  });

  it('기한이 지나도 반납 처리 전까지 계속 점유한다 (자동 종료 폐지)', () => {
    at('2026-10-25T10:00:00');
    const s = calculateGameStatus(game, [hold()]);
    expect(s.status).toBe('대여중');
    expect(s.available_count).toBe(0);
    expect(s.rentals).toHaveLength(1);
  });

  it('반납 처리된 HOLD 는 점유하지 않는다', () => {
    at('2026-10-25T10:00:00');
    const s = calculateGameStatus(game, [hold({ returned_at: kst('2026-10-24T10:00:00').toISOString() })]);
    expect(s.status).toBe('대여가능');
  });

  it('dueDate 는 회원 찜·대여만, 단체 기한은 holdDueDate 로 따로', () => {
    at('2026-10-21T10:00:00');
    const rent = {
      rental_id: 'r1', type: 'RENT', user_id: 'u1', returned_at: null,
      borrowed_at: kst('2026-10-21T09:00:00').toISOString(),
      due_date: kst('2026-10-23T00:00:00').toISOString(),
    };
    const s = calculateGameStatus({ ...game, quantity: 2 }, [hold(), rent]);
    expect(s.dueDate).toBe(rent.due_date);
    expect(s.holdDueDate).toBe(hold().due_date);
    expect(s.adminStatus).toBe('대여중');
  });
});

describe('holdOverdueDays — 기한 다음 날(KST)부터 1일', () => {
  const due = kst('2026-10-23T14:00:00').toISOString();
  it.each([
    ['2026-10-23T13:00:00', 0],
    ['2026-10-23T23:59:59', 0], // 기한 당일은 연체 아님
    ['2026-10-24T00:00:00', 1],
    ['2026-10-26T09:00:00', 3],
  ])('%s → %i', (now, expected) => {
    expect(holdOverdueDays(due, kst(now))).toBe(expected);
  });

  it('00:00 마감은 전날 밤 12시로 본다', () => {
    const midnight = kst('2026-10-24T00:00:00').toISOString();
    expect(holdOverdueDays(midnight, kst('2026-10-24T09:00:00'))).toBe(1);
  });

  it('잘못된 값은 0', () => {
    expect(holdOverdueDays('x')).toBe(0);
  });
});
