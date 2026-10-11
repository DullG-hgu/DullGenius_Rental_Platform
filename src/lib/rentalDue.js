// 대여 기한 D-Day 계산 (KST 달력 기준, 브라우저 타임존과 무관)
//
// 마감 시각은 경로마다 모양이 다르다 (database/_LIVE/functions.sql):
//   - 키오스크 rental_due_date(): 다다음날 00:00 KST = 「다음날 밤 12시」
//   - admin_extend_rentals: N일 뒤 23:59:59 KST
//   - rent_game / admin_rent_game: 대여 시각 + 7×24시간
// 00:00 마감은 「그 전날 밤 12시」이므로, 마감 1ms 전이 속한 KST 날짜를 반납일로 본다.
// (1초 전으로 잡으면 밀리초가 붙은 7×24시간 마감이 자정 직후일 때 「D--1」이 나온다)

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const kstDayNumber = (ms) => Math.floor((ms + KST_OFFSET_MS) / DAY_MS);

/** 반납일(KST)까지 남은 날 수. 0 = 오늘이 반납일, 음수 = 지난 날 수. 마감 시각을 넘겼으면 overdue. */
export const rentalDueDays = (dueDate, now = new Date()) => {
  const due = new Date(dueDate).getTime();
  const nowMs = now.getTime();
  if (Number.isNaN(due)) return null;
  const days = kstDayNumber(due - 1) - kstDayNumber(nowMs);
  return { days, overdue: due <= nowMs };
};

export const rentalDDayLabel = (dueDate, now = new Date()) => {
  const r = rentalDueDays(dueDate, now);
  if (!r) return "-";
  if (r.overdue) return `연체 ${Math.max(1, -r.days)}일`;
  if (r.days === 0) return "오늘 반납";
  return `반납까지 D-${r.days}`;
};

/**
 * 단체대여(HOLD) 연체 일수. 기한 다음 날(KST)부터 1일 — 기한 당일은 0.
 * (회원 대여는 마감 순간부터 연체지만, 단체대여는 2026-10-11 결정으로 다음 날부터 센다)
 */
export const holdOverdueDays = (dueDate, now = new Date()) => {
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return 0;
  return Math.max(0, kstDayNumber(now.getTime()) - kstDayNumber(due - 1));
};
