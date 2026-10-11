// src/admin/AdminOverviewCard.jsx
// 관리자 대시보드 맨 위 할 일 알림 — 한 줄짜리 항목만, 할 일이 있는 것만 보이고 하나도 없으면 섹션째 숨긴다.
// (10/12 사용자 피드백: 상태 안내까지 늘 깔려 있어 게임 관리가 밀렸다 → 할 일 있을 때만, 다시 한 줄 목록으로 축소.
//  예전 「처음 사용하시나요?」 안내는 대여 현황 탭 맨 아래로 옮겼다)
//   - 오피스아워: 켜져 있을 때만. 목적은 끄는 걸 잊지 않게 (켜는 건 오피스아워 탭)
//   - 외부 대여 신청: 처리할 신청(대기·검토 필요)이 있을 때만
//   - 미처리 신고·신청: 1건 이상일 때만
//   - 반납 기한 지난 게임: 1건 이상일 때만 — 「대여자별 처리」 모달 진입점 (나중에 단체 연체도 여기에 합류)
// 카운트를 불러오는 동안은 섹션을 숨긴 채 둔다 (카드가 하나씩 튀어나오는 깜빡임 방지).

import { useEffect, useState } from 'react';
import { fetchDamageReports, fetchGameRequests, fetchRentalRequests } from '../api';
import { holdOverdueDays, rentalDueDays } from '../lib/rentalDue';

// 「처리할」 외부 대여 신청 — 확정 건(auto/manual_confirmed)은 반납 관리 대상이라 여기서 세지 않는다
const ACTIONABLE_RENTAL_STATUSES = ['pending', 'needs_review'];

function AdminOverviewCard({ games = [], gamesLoading = false, isOfficeOpen, onGoReports, onGoRentalRequests, onGoOffice, onOpenWorkList }) {
    const [pendingReports, setPendingReports] = useState(null); // null = 로딩 중
    const [pendingRequests, setPendingRequests] = useState(null);
    const [pendingRentals, setPendingRentals] = useState(null);
    const [failedCounts, setFailedCounts] = useState([]); // 불러오지 못한 카운트 이름 — 0건으로 조용히 숨기지 않고 알린다

    useEffect(() => {
        let cancelled = false;
        // 세 카운트는 서로 독립 — 하나가 실패해도 나머지 카드는 보인다. 실패한 쪽은 「확인 실패」 카드로 알린다
        const load = async () => {
            const [reports, requests, rentals] = await Promise.allSettled([
                fetchDamageReports(),
                fetchGameRequests(),
                fetchRentalRequests(ACTIONABLE_RENTAL_STATUSES),
            ]);
            if (cancelled) return;
            const failed = [];
            const countOf = (result, label, pick) => {
                if (result.status === 'fulfilled') return (result.value || []).filter(pick).length;
                console.warn(`[AdminOverviewCard] ${label} 카운트 실패:`, result.reason);
                failed.push(label);
                return 0;
            };
            setPendingReports(countOf(reports, '파손 신고', r => r.status === 'pending'));
            setPendingRequests(countOf(requests, '게임 신청', r => r.status === 'pending'));
            setPendingRentals(countOf(rentals, '외부 대여 신청', r => ACTIONABLE_RENTAL_STATUSES.includes(r.status)));
            setFailedCounts(failed);
        };
        load();
        return () => { cancelled = true; };
    }, []);

    if (pendingReports === null || gamesLoading) return null;

    // 연체 건수: adminStatus가 대여중/일부대여중이고 마감을 넘긴 게임 수 (판정은 rentalDue.js — 대여 현황 목록과 같다)
    const now = new Date();
    const overdueCount = games.filter(g => {
        if (!g.dueDate) return false;
        const isRentedOut = g.adminStatus === '대여중' || g.adminStatus === '일부대여중';
        return isRentedOut && !!rentalDueDays(g.dueDate, now)?.overdue;
    }).length;
    // 단체(외부) 대여 연체 — 자동 종료가 없어 반납 처리 전까지 HOLD 가 열려 있다. 신청 단위로 센다(기한 다음 날부터)
    const holdOverdueRequests = new Set();
    for (const g of games) {
        for (const r of g.rentals || []) {
            if (r.type !== 'HOLD' || r.returned_at || !r.due_date) continue;
            if (holdOverdueDays(r.due_date, now) > 0) holdOverdueRequests.add(r.request_id || r.rental_id);
        }
    }
    const holdOverdueCount = holdOverdueRequests.size;
    const totalOverdue = overdueCount + holdOverdueCount;

    const rentalCount = pendingRentals ?? 0;

    // 한 줄 알림: 아이콘·항목·건수 + 오른쪽 버튼 1개 (10/12 사용자 확정 — 제목·설명 줄 없이)
    const rows = [];
    if (totalOverdue > 0) {
        const count = holdOverdueCount > 0 ? `${totalOverdue}건 (단체 ${holdOverdueCount})` : `${totalOverdue}건`;
        rows.push({ key: 'overdue', icon: '⏰', label: '반납 기한 지남', count, tone: 'danger', action: '대여자별 처리', onAction: onOpenWorkList });
    }
    if (isOfficeOpen) {
        rows.push({ key: 'office', icon: '🟢', label: '오피스아워 켜짐', count: null, tone: 'ok', action: '끄기', onAction: onGoOffice, hint: '운영이 끝나면 퇴근 처리' });
    }
    if (rentalCount > 0) {
        rows.push({ key: 'rental', icon: '📝', label: '외부 대여 신청', count: `${rentalCount}건`, tone: 'warn', action: '보기', onAction: onGoRentalRequests });
    }
    if (pendingReports > 0) {
        rows.push({ key: 'reports', icon: '📢', label: '미처리 신고', count: `${pendingReports}건`, tone: 'warn', action: '보기', onAction: onGoReports });
    }
    if (pendingRequests > 0) {
        rows.push({ key: 'requests', icon: '🎲', label: '미처리 게임 신청', count: `${pendingRequests}건`, tone: 'warn', action: '보기', onAction: onGoReports });
    }
    if (failedCounts.length > 0) {
        // 실패한 서비스 이름이 잘리면 어느 탭을 봐야 할지 모른다 — 이 줄만 줄바꿈 허용(is-wrap), title 에도 이름
        rows.push({ key: 'failed', icon: '⚠️', label: '건수 확인 실패', count: failedCounts.join(' · '), tone: 'info', wrap: true, hint: `${failedCounts.join(' · ')} — 해당 탭에서 직접 확인` });
    }

    if (rows.length === 0) return null;

    return (
        <section className="admin-alerts" aria-label="처리할 일">
            {rows.map((r) => (
                <div key={r.key} className={`admin-alert-row is-${r.tone}${r.wrap ? ' is-wrap' : ''}`} title={r.hint}>
                    <span className="admin-alert-icon" aria-hidden="true">{r.icon}</span>
                    <span className="admin-alert-text">
                        {r.label}
                        {r.count && <strong className="admin-alert-count"> {r.count}</strong>}
                    </span>
                    {r.action && r.onAction && (
                        <button type="button" className="admin-alert-btn" onClick={r.onAction}>{r.action}</button>
                    )}
                </div>
            ))}
        </section>
    );
}

export default AdminOverviewCard;
