import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../lib/supabaseClient.jsx';

const ACTIONS = [
  ['RENT', '대여'], ['RETURN', '반납'], ['DIBS', '찜'], ['DIBS_END', '찜 종료'],
  ['SEARCH', '검색'], ['VIEW', '상세 조회'],
];

const CARD_STYLE = {
  background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)',
  borderRadius: '8px', padding: '20px',
};

const TOOLTIP_STYLE = {
  contentStyle: { background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', color: 'var(--admin-text-main)' },
};

function toDateInput(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function defaultFilters() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return { startDate: toDateInput(start), endDate: toDateInput(end), userId: '', gameId: '', actions: [] };
}

function number(value) {
  return Number(value ?? 0).toLocaleString('ko-KR');
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export default function AdminAnalytics() {
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [users, setUsers] = useState([]);
  const [games, setGames] = useState([]);
  const [summary, setSummary] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [activity, setActivity] = useState([]);
  const [unavailableViews, setUnavailableViews] = useState([]);
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadFilterOptions() {
      const [usersRes, gamesRes] = await Promise.all([
        supabase.from('profiles').select('id, name, student_id').order('name').limit(1000),
        supabase.from('games').select('id, name').order('name').limit(1000),
      ]);
      if (!usersRes.error) setUsers(usersRes.data ?? []);
      if (!gamesRes.error) setGames(gamesRes.data ?? []);
    }
    loadFilterOptions();
  }, []);

  useEffect(() => {
    async function loadAnalytics() {
      setLoading(true);
      setError('');
      const params = {
        p_start_date: appliedFilters.startDate,
        p_end_date: appliedFilters.endDate,
        p_user_id: appliedFilters.userId || null,
        p_game_id: appliedFilters.gameId ? Number(appliedFilters.gameId) : null,
        p_action_types: appliedFilters.actions.length ? appliedFilters.actions : null,
      };

      try {
        const [summaryRes, timelineRes, rankingRes, activityRes, unavailableViewsRes, purchaseRequestsRes] = await Promise.all([
          supabase.rpc('get_admin_analytics_summary', params),
          supabase.rpc('get_admin_analytics_timeline', params),
          supabase.rpc('get_admin_analytics_rankings', { ...params, p_limit: 10 }),
          supabase.rpc('get_admin_analytics_activity', { ...params, p_limit: 150 }),
          supabase.rpc('get_admin_unavailable_game_views', {
            p_start_date: params.p_start_date,
            p_end_date: params.p_end_date,
            p_user_id: params.p_user_id,
            p_game_id: params.p_game_id,
            p_limit: 20,
          }),
          supabase.rpc('get_admin_game_purchase_requests', {
            p_start_date: params.p_start_date,
            p_end_date: params.p_end_date,
            p_user_id: params.p_user_id,
            p_game_id: params.p_game_id,
            p_limit: 100,
          }),
        ]);
        const failed = [summaryRes, timelineRes, rankingRes, activityRes, unavailableViewsRes, purchaseRequestsRes].find((result) => result.error);
        if (failed) throw failed.error;
        setSummary(summaryRes.data?.[0] ?? null);
        setTimeline(timelineRes.data ?? []);
        setRankings(rankingRes.data ?? []);
        setActivity(activityRes.data ?? []);
        setUnavailableViews(unavailableViewsRes.data ?? []);
        setPurchaseRequests(purchaseRequestsRes.data ?? []);
      } catch (loadError) {
        console.error('Admin analytics load error:', loadError);
        setSummary(null);
        setTimeline([]);
        setRankings([]);
        setActivity([]);
        setUnavailableViews([]);
        setPurchaseRequests([]);
        setError(loadError?.message || '고급 통계를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    }
    loadAnalytics();
  }, [appliedFilters]);

  const selectedActionText = appliedFilters.actions.length
    ? appliedFilters.actions.map((action) => ACTIONS.find(([key]) => key === action)?.[1] ?? action).join(', ')
    : '전체 행동';
  const borrowers = useMemo(() => rankings.filter((row) => row.kind === 'borrower'), [rankings]);
  const rankedGames = useMemo(() => rankings.filter((row) => row.kind === 'game'), [rankings]);
  const timelineData = useMemo(() => timeline.map((row) => ({
    ...row,
    label: String(row.date).slice(5).replace('-', '/'),
  })), [timeline]);
  const unavailableClickCount = useMemo(
    () => unavailableViews.reduce((total, row) => total + Number(row.unavailable_click_count ?? 0), 0),
    [unavailableViews],
  );
  const purchaseRequestCount = purchaseRequests[0]?.total_count ?? purchaseRequests.length;

  const changeFilter = (key, value) => setFilters((previous) => ({ ...previous, [key]: value }));
  const toggleAction = (action) => setFilters((previous) => ({
    ...previous,
    actions: previous.actions.includes(action)
      ? previous.actions.filter((item) => item !== action)
      : [...previous.actions, action],
  }));

  const applyFilters = () => {
    if (!filters.startDate || !filters.endDate || filters.startDate > filters.endDate) {
      setError('시작일과 종료일을 올바르게 선택해 주세요.');
      return;
    }
    const span = (new Date(`${filters.endDate}T00:00:00`) - new Date(`${filters.startDate}T00:00:00`)) / 86400000;
    if (span > 365) {
      setError('조회 기간은 최대 366일입니다.');
      return;
    }
    setAppliedFilters({ ...filters, actions: [...filters.actions] });
  };

  const setPreset = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setFilters((previous) => ({ ...previous, startDate: toDateInput(start), endDate: toDateInput(end) }));
  };

  const exportActivity = () => {
    const header = ['시각', '행동', '회원', '게임', '채널', '세부 정보'];
    const rows = activity.map((row) => [
      formatDateTime(row.occurred_at), actionLabel(row.action_type), row.user_name ?? '-', row.game_name ?? '-', row.source ?? '-',
      row.details ? JSON.stringify(row.details) : '',
    ]);
    const blob = new Blob([`\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `관리자-활동로그_${appliedFilters.startDate}_${appliedFilters.endDate}.csv`;
    // 모바일 브라우저는 DOM에 붙지 않은 앵커나 즉시 revoke 된 blob URL 을 무시할 수 있다
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={CARD_STYLE}>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--admin-text-main)' }}>고급 활동 분석</h3>
            <p style={{ margin: '6px 0 0', color: 'var(--admin-text-sub)', fontSize: '0.88rem' }}>
              기간·회원·게임·행동을 조합해 대여, 찜, 검색, 조회 기록을 비교합니다.
            </p>
          </div>
          <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.8rem' }}>적용 행동: {selectedActionText}</span>
        </div>

        <div className="analytics-filter-grid">
          <label>시작일<input className="admin-input" type="date" value={filters.startDate} onChange={(event) => changeFilter('startDate', event.target.value)} /></label>
          <label>종료일<input className="admin-input" type="date" value={filters.endDate} onChange={(event) => changeFilter('endDate', event.target.value)} /></label>
          <label>대여자 / 회원
            <select className="admin-input" value={filters.userId} onChange={(event) => changeFilter('userId', event.target.value)}>
              <option value="">전체 회원</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.student_id})</option>)}
            </select>
          </label>
          <label>게임
            <select className="admin-input" value={filters.gameId} onChange={(event) => changeFilter('gameId', event.target.value)}>
              <option value="">전체 게임</option>
              {games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
          <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem', marginRight: '4px' }}>행동</span>
          {ACTIONS.map(([action, label]) => (
            <label key={action} className={`analytics-action-chip ${filters.actions.includes(action) ? 'is-selected' : ''}`}>
              <input type="checkbox" checked={filters.actions.includes(action)} onChange={() => toggleAction(action)} />{label}
            </label>
          ))}
          <button type="button" className="analytics-clear-button" onClick={() => changeFilter('actions', [])}>전체</button>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '16px' }}>
          {[7, 30, 90, 365].map((days) => <button type="button" className="analytics-preset-button" onClick={() => setPreset(days)} key={days}>최근 {days}일</button>)}
          <button type="button" className="admin-btn" onClick={applyFilters} style={{ background: '#667eea', color: '#fff', marginLeft: 'auto' }}>분석 적용</button>
        </div>
      </div>

      {error && <div className="analytics-error">{error}</div>}

      <div style={{ opacity: loading ? 0.45 : 1, transition: 'opacity 0.2s', display: 'flex', flexDirection: 'column', gap: '16px' }} aria-busy={loading}>
        <div className="analytics-summary-grid">
          {[
            ['대여', summary?.rent_count], ['반납', summary?.return_count], ['찜', summary?.dibs_count],
            ['고유 대여자', summary?.unique_borrower_count], ['검색', summary?.search_count], ['상세 조회', summary?.view_count],
            ['재고 없음 클릭', unavailableClickCount], ['추가 구매 요청', purchaseRequestCount],
            ['평균 대여 시간', summary?.avg_duration_hours == null ? '-' : `${number(summary.avg_duration_hours)}시간`], ['연체 반납', summary?.overdue_return_count],
          ].map(([label, value]) => (
            <div key={label} style={{ ...CARD_STYLE, padding: '14px' }}>
              <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.8rem' }}>{label}</div>
              <strong style={{ display: 'block', marginTop: '5px', fontSize: '1.35rem', color: 'var(--admin-text-main)' }}>{loading ? '…' : (typeof value === 'number' || typeof value === 'bigint' ? number(value) : value ?? '0')}</strong>
            </div>
          ))}
        </div>

        <CollapsibleCard title="행동 추이" subtitle="날짜별 대여·반납·찜·검색·상세 조회">
          {timelineData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={timelineData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-border)" />
                <XAxis dataKey="label" stroke="#a0a0a0" tick={{ fill: '#a0a0a0', fontSize: 11 }} minTickGap={20} />
                <YAxis allowDecimals={false} stroke="#a0a0a0" tick={{ fill: '#a0a0a0', fontSize: 11 }} />
                <Tooltip {...TOOLTIP_STYLE} /><Legend wrapperStyle={{ color: 'var(--admin-text-main)' }} />
                <Bar dataKey="rent_count" name="대여" fill="#667eea" stackId="rental" />
                <Bar dataKey="return_count" name="반납" fill="#48bb78" stackId="rental" />
                <Bar dataKey="dibs_count" name="찜" fill="#ed8936" />
                <Bar dataKey="search_count" name="검색" fill="#bb86fc" />
                <Bar dataKey="view_count" name="상세 조회" fill="#38b2ac" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CollapsibleCard>

        <div className="analytics-ranking-grid">
          <RankingTable title="활동 상위 대여자" rows={borrowers} empty="조건에 맞는 대여자가 없습니다." />
          <RankingTable title="대여·찜 상위 게임" rows={rankedGames} empty="조건에 맞는 게임 기록이 없습니다." />
        </div>

        <div className="analytics-ranking-grid">
          <CollapsibleCard title="재고 없음 상태 클릭" subtitle="상세 페이지를 열 당시 대여 가능한 재고가 없던 게임">
            <p className="analytics-note">상태 스냅샷 기록이 시작된 뒤의 조회부터 정확히 집계됩니다.</p>
            {unavailableViews.length === 0 ? <Empty text="조건에 맞는 재고 없음 클릭 기록이 없습니다." /> : <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>게임</th><th>클릭</th><th>최근 클릭</th></tr></thead>
              <tbody>{unavailableViews.map((row) => <tr key={row.game_id}><td>{row.game_name}</td><td>{number(row.unavailable_click_count)}</td><td>{formatDateTime(row.last_clicked_at)}</td></tr>)}</tbody>
            </table></div>}
          </CollapsibleCard>

          <CollapsibleCard title="추가 구매 요청" subtitle={`최대 100건 · 전체 ${number(purchaseRequestCount)}건`}>
            {purchaseRequests.length === 0 ? <Empty text="조건에 맞는 추가 구매 요청이 없습니다." /> : <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>요청 게임</th><th>요청자</th><th>상태</th><th>요청일</th></tr></thead>
              <tbody>{purchaseRequests.map((row) => <tr key={row.request_id}><td>{row.game_title}{row.description && <small>{row.description}</small>}</td><td>{row.user_name}</td><td><RequestStatus status={row.status} /></td><td>{formatDateTime(row.created_at)}</td></tr>)}</tbody>
            </table></div>}
          </CollapsibleCard>
        </div>

        <CollapsibleCard
          title="통합 활동 로그"
          subtitle="최대 150건 · 최신순"
          defaultOpen={false}
          headerAction={<button type="button" className="analytics-preset-button" disabled={!activity.length} onClick={exportActivity}>CSV 내보내기</button>}
        >
          <div className="analytics-table-wrap">
            {activity.length === 0 ? <Empty text="조건에 맞는 활동 로그가 없습니다." /> : (
              <table className="analytics-table">
                <thead><tr><th>시각</th><th>행동</th><th>회원</th><th>게임</th><th>채널 / 세부</th></tr></thead>
                <tbody>{activity.map((row, index) => <tr key={`${row.occurred_at}-${row.action_type}-${index}`}>
                  <td>{formatDateTime(row.occurred_at)}</td><td><ActionBadge action={row.action_type} /></td><td>{row.user_name ?? '비회원/시스템'}</td><td>{row.game_name ?? '-'}</td>
                  <td><span>{row.source ?? '-'}</span>{row.details && <small>{formatDetails(row.details)}</small>}</td>
                </tr>)}</tbody>
              </table>
            )}
          </div>
        </CollapsibleCard>
      </div>
    </section>
  );
}

function RankingTable({ title, rows, empty }) {
  return <CollapsibleCard title={title}>
    {rows.length === 0 ? <Empty text={empty} /> : <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>이름</th><th>대여</th><th>찜</th><th>반납</th><th>평균</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.entity_id}><td>{row.entity_name}</td><td>{number(row.rent_count)}</td><td>{number(row.dibs_count)}</td><td>{number(row.return_count)}</td><td>{row.avg_duration_hours == null ? '-' : `${number(row.avg_duration_hours)}시간`}</td></tr>)}</tbody>
    </table></div>}
  </CollapsibleCard>;
}

function CollapsibleCard({ title, subtitle, children, defaultOpen = true, headerAction }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return <section style={{ ...CARD_STYLE, padding: 0, overflow: 'hidden' }}>
    <div className="analytics-collapsible-header">
      <button type="button" className="analytics-collapsible-toggle" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
        <span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
        <span aria-hidden="true" className={isOpen ? 'is-open' : ''}>⌄</span>
      </button>
      {headerAction && <div className="analytics-collapsible-action">{headerAction}</div>}
    </div>
    {isOpen && <div style={{ padding: '0 20px 20px' }}>{children}</div>}
  </section>;
}

function Empty({ text = '데이터가 없습니다.' }) {
  return <div style={{ padding: '32px', textAlign: 'center', color: 'var(--admin-text-sub)' }}>{text}</div>;
}

function actionLabel(action) {
  return ACTIONS.find(([key]) => key === action)?.[1] ?? action;
}

function ActionBadge({ action }) {
  const colors = { RENT: '#667eea', RETURN: '#48bb78', DIBS: '#ed8936', DIBS_END: '#a0a0a0', SEARCH: '#bb86fc', VIEW: '#38b2ac' };
  return <span style={{ color: colors[action] ?? '#a0a0a0', fontWeight: 600 }}>{actionLabel(action)}</span>;
}

function RequestStatus({ status }) {
  const labels = { pending: '대기', approved: '승인', purchased: '구매 완료', rejected: '반려' };
  return <span className="analytics-request-status">{labels[status] ?? status ?? '대기'}</span>;
}

function formatDetails(details) {
  if (typeof details === 'string') return details;
  const safe = { ...details };
  delete safe.rental_id;
  if (safe.due_date) safe.due_date = `마감 ${formatDateTime(safe.due_date)}`;
  if (safe.overdue === true) safe.overdue = '연체 반납';
  return Object.values(safe).filter(Boolean).join(' · ') || '-';
}
