// 통계 탭 「외부 대여」 섹션 — 행사·단체 대여(HOLD) 집계. 회원 통계와 섞지 않는다.
// 기간은 통계 탭의 기간(최근 N일)을 그대로 쓴다: KST 오늘을 끝으로 N일, 양끝 포함 (get_external_rental_stats).
import { useEffect, useRef, useState } from 'react';
import { fetchExternalRentalStats } from '../api';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 최근 days일(KST 오늘 포함)의 시작·끝 날짜 'YYYY-MM-DD' */
export const kstPeriod = (days, now = new Date()) => {
  const kstToday = new Date(now.getTime() + KST_OFFSET_MS);
  const end = kstToday.toISOString().slice(0, 10);
  const start = new Date(kstToday.getTime() - (Math.max(1, days) - 1) * DAY_MS).toISOString().slice(0, 10);
  return { start, end };
};

const fmt = (v, digits = 0) => (v === null || v === undefined || Number.isNaN(Number(v))
  ? '-'
  : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: digits }));

const STATUS_TEXT = {
  pending: '대기', needs_review: '검토 필요', auto_confirmed: '자동 확정', manual_confirmed: '수동 확정',
  returned: '반납 완료', rejected: '반려', cancelled: '취소',
};

export default function ExternalRentalStatsPanel({ period = 30 }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestRef = useRef(0); // 기간 연타 시 늦게 온 이전 응답이 덮어쓰지 않게

  useEffect(() => {
    const req = ++requestRef.current;
    const { start, end } = kstPeriod(period);
    setLoading(true);
    setError(null);
    fetchExternalRentalStats(start, end)
      .then((data) => { if (requestRef.current === req) setStats(data || null); })
      .catch((e) => {
        if (requestRef.current !== req) return;
        console.error('[ExternalRentalStatsPanel] 외부 대여 통계 실패:', e);
        setError(e);
      })
      .finally(() => { if (requestRef.current === req) setLoading(false); });
  }, [period]);

  const tiles = stats ? [
    ['신청', stats.requests],
    ['대여 중', stats.rentals_open],
    ['반납 완료', stats.rentals_returned],
    ['단체 연체 (진행 중)', stats.overdue_open],
    ['빌려 간 게임 수', stats.game_copies],
    ['평균 기간(일)', stats.avg_duration_days, 1],
  ] : [];
  const byStatus = stats?.by_status ? Object.entries(stats.by_status).filter(([, n]) => n > 0) : [];

  return (
    <section className="admin-card" aria-labelledby="external-rental-stats-title">
      <h3 id="external-rental-stats-title" style={{ color: 'var(--admin-text-main)', marginTop: 0, marginBottom: '4px' }}>
        외부 대여 (행사·단체)
      </h3>
      <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.85em', marginBottom: '16px' }}>
        {stats?.period ? `${stats.period.start} ~ ${stats.period.end}` : `최근 ${period}일`} · 회원 대여와 별도 집계 · 신청은 접수일, 대여는 수령일 기준
      </div>
      {loading && !stats ? (
        <p role="status" style={{ color: 'var(--admin-text-sub)' }}>불러오는 중…</p>
      ) : error ? (
        <p role="alert" style={{ color: 'var(--admin-text-sub)' }}>외부 대여 집계를 불러오지 못함</p>
      ) : !stats ? (
        <p style={{ color: 'var(--admin-text-sub)' }}>집계 없음</p>
      ) : (
        <>
          <div className="admin-grid-auto" style={{ '--min': '140px' }}>
            {tiles.map(([label, value, digits]) => (
              <div key={label} style={{ background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: '10px', padding: '12px' }}>
                <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.85em' }}>{label}</div>
                <div style={{ color: 'var(--admin-text-main)', fontSize: '1.4em', fontWeight: 700 }}>{fmt(value, digits)}</div>
              </div>
            ))}
          </div>
          {byStatus.length > 0 && (
            <div className="admin-btn-row" style={{ marginTop: '12px', gap: '6px' }}>
              {byStatus.map(([status, n]) => (
                <span key={status} className="admin-worklist-badge">{STATUS_TEXT[status] || status} {fmt(n)}</span>
              ))}
            </div>
          )}
          {stats.top_games?.length > 0 && (
            <ol style={{ margin: '16px 0 0', paddingLeft: '20px', color: 'var(--admin-text-main)', lineHeight: 1.8 }}>
              {stats.top_games.map((g) => (
                <li key={g.game_id ?? g.name}>
                  {g.name} <span style={{ color: 'var(--admin-text-sub)' }}>· {fmt(g.copies)}개 · 신청 {fmt(g.requests)}건</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
