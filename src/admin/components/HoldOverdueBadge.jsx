// 단체(외부) 대여 연체 배지 — 기한 다음 날(KST)부터 「단체 연체 N일」.
// 판정은 rentalDue.js 의 holdOverdueDays 한 곳 (회원 대여와 달리 기한 당일은 연체가 아니다).
// 단체 대여는 자동 종료하지 않고 관리자가 반납해야 끝나므로, 반납 전까지 날 수가 계속 는다.
import { holdOverdueDays } from '../../lib/rentalDue';

function HoldOverdueBadge({ dueDate, now }) {
  if (!dueDate) return null;
  const days = holdOverdueDays(dueDate, now);
  if (days <= 0) return null;
  return (
    <span className="admin-worklist-badge is-overdue" title="단체 대여 기한 경과 — 반납 처리 필요">
      단체 연체 {days}일
    </span>
  );
}

export default HoldOverdueBadge;
