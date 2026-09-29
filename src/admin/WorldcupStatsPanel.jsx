// 이상형 월드컵 통계 (관리자 통계 탭 → 「🏆 이상형 월드컵 통계 보기」)
// 집계만 보여준다 — 회원 개인의 취향은 여기서 보지 않는다 (spec §6-2). tester 계정 판은 서버에서 제외.
import { useCallback, useEffect, useState } from 'react';
import { fetchWorldcupAdminStats, fetchWorldcupInsights, fetchWorldcupRanking } from '../api_fun';

const SLUG = 'all-boardgames';

const CARD_STYLE = {
  background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)',
  borderRadius: '8px', padding: '16px',
};
const TH = { textAlign: 'left', padding: '8px 10px', color: 'var(--admin-text-sub)', fontWeight: 'normal', whiteSpace: 'nowrap' };
const TD = { padding: '8px 10px', color: 'var(--admin-text-main)', whiteSpace: 'nowrap' };

const pct = (v) => (v == null ? '-' : `${Math.round(Number(v) * 1000) / 10}%`);
const num = (v) => Number(v ?? 0).toLocaleString('ko-KR');
const sum = (obj) => Object.values(obj ?? {}).reduce((a, b) => a + Number(b), 0);
const roundLabel = (n) => (n === 2 ? '결승' : `${n}강`);

const SIGNAL_LABEL = {
  curious: '끌림',
  classic: '검증된 명작',
  first_impression: '첫인상만 좋음',
};

const Toggle = ({ options, value, onChange, label }) => (
  <div role="group" aria-label={label} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
    {options.map(([key, text]) => (
      <button
        key={key}
        type="button"
        aria-pressed={value === key}
        onClick={() => onChange(key)}
        style={{
          padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--admin-border)', cursor: 'pointer',
          background: value === key ? '#667eea' : 'var(--admin-card-bg)',
          color: value === key ? '#fff' : 'var(--admin-text-main)',
          fontWeight: value === key ? 'bold' : 'normal',
        }}
      >
        {text}
      </button>
    ))}
  </div>
);

const Table = ({ head, rows, empty }) => (
  rows.length === 0 ? (
    <div style={{ color: 'var(--admin-text-sub)', padding: '16px', textAlign: 'center' }}>{empty}</div>
  ) : (
    <div className="admin-table-wrap">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--admin-border)' }}>
            {head.map((h) => <th key={h} style={TH}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--admin-border)' }}>
              {cells.map((c, j) => <td key={j} style={TD}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
);

export default function WorldcupStatsPanel() {
  const [days, setDays] = useState(30);
  const [scope, setScope] = useState('all');
  const [stats, setStats] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [insights, setInsights] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    Promise.all([
      fetchWorldcupAdminStats({ slug: SLUG, from }),
      fetchWorldcupRanking(SLUG, scope),
      fetchWorldcupInsights(SLUG, scope, 5),
    ])
      .then(([s, r, i]) => { setStats(s); setRanking(r); setInsights(i); })
      .catch((e) => setError(e?.message || '월드컵 통계를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [days, scope]);

  useEffect(() => { load(); }, [load]);

  const finished = Number(stats?.runs?.member?.finished ?? 0) + Number(stats?.runs?.nonmember?.finished ?? 0);
  const abandoned = Number(stats?.runs?.member?.abandoned ?? 0) + Number(stats?.runs?.nonmember?.abandoned ?? 0);
  const started = sum(stats?.runs?.member) + sum(stats?.runs?.nonmember);
  const rankItems = ranking?.items ?? [];
  const visibleRank = showAll ? rankItems : rankItems.slice(0, 20);
  const insightItems = (insights?.items ?? []).filter((i) => i.familiarity != null || i.curiosity_rate != null || i.experienced_rate != null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Toggle label="기간" value={days} onChange={setDays} options={[[7, '7일'], [30, '30일'], [90, '90일']]} />
        <Toggle label="집계 범위" value={scope} onChange={setScope} options={[['all', '전체'], ['member', '회원만']]} />
        <button type="button" onClick={load} disabled={loading}
          style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--admin-border)', background: 'var(--admin-card-bg)', color: 'var(--admin-text-main)', cursor: 'pointer' }}>
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--admin-text-sub)' }}>
        기간은 판 요약에만 적용되고, 랭킹·「안 해봄」 통계는 전체 기간 누적입니다. 개발자(tester) 계정 판은 제외됩니다.
      </div>

      {error && (
        <div role="alert" style={{ ...CARD_STYLE, color: '#e74c3c' }}>
          {error} <button type="button" onClick={load} style={{ marginLeft: '8px' }}>다시 시도</button>
        </div>
      )}

      {stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
            {[
              ['시작한 판', num(started)],
              ['끝까지 한 판', `${num(finished)} (${started ? pct(finished / started) : '-'})`],
              ['중간에 끈 판', num(abandoned)],
              ['회원 / 비회원 판', `${num(sum(stats.runs?.member))} / ${num(sum(stats.runs?.nonmember))}`],
              ['1:1 대결 수', `${num(stats.matches)} (미완료 판 ${num(stats.matches_from_unfinished)})`],
              ['위 카드 선택률', pct(stats.top_pick_rate)],
              ['고른 시간 중앙값', stats.median_decide_ms == null ? '-' : `${(stats.median_decide_ms / 1000).toFixed(1)}초`],
              ['참여 회원 / 기기', `${num(stats.distinct_members)} / ${num(stats.distinct_devices)}`],
            ].map(([label, value]) => (
              <div key={label} style={{ ...CARD_STYLE, textAlign: 'center' }}>
                <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.8rem', marginBottom: '6px' }}>{label}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--admin-text-main)' }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
            <div style={CARD_STYLE}>
              <h4 style={{ margin: '0 0 8px', color: 'var(--admin-text-main)' }}>강수별 완주율</h4>
              <Table
                head={['강수', '시작', '완주', '완주율']}
                rows={(stats.completion_by_size ?? []).map((r) => [`${r.size}강`, num(r.started), num(r.finished), pct(r.rate)])}
                empty="아직 기록이 없습니다."
              />
            </div>
            <div style={CARD_STYLE}>
              <h4 style={{ margin: '0 0 8px', color: 'var(--admin-text-main)' }}>어디서 많이 끄나 (이탈 판)</h4>
              <Table
                head={['강수', '마지막 도달', '판 수', '평균 대결']}
                rows={(stats.dropoff ?? []).map((r) => [`${r.size}강`, roundLabel(r.reached_round), num(r.runs), r.avg_played])}
                empty="이탈한 판이 없습니다."
              />
            </div>
          </div>
        </>
      )}

      {ranking && (
        <div style={CARD_STYLE}>
          <h4 style={{ margin: '0 0 4px', color: 'var(--admin-text-main)' }}>게임 랭킹 (1:1 승률순)</h4>
          <div style={{ fontSize: '0.8rem', color: 'var(--admin-text-sub)', marginBottom: '8px' }}>
            완료 {num(ranking.total_runs)}판 기준 · 대결 {ranking.min_matches}번 미만은 순위 밖(회색) · 안 해본 채로 = 「안 해봄」 표시된 대결
          </div>
          <Table
            head={['#', '게임', '승률', '승-패', '우승', '우승률', '안 해본 채로']}
            rows={visibleRank.map((it, i) => [
              it.ranked ? i + 1 : '·',
              <span key="n" style={{ opacity: it.ranked ? 1 : 0.55 }}>{it.name}</span>,
              pct(it.win_rate), `${it.wins}-${it.losses}`, num(it.championships), pct(it.champion_rate),
              it.unplayed_wins + it.unplayed_losses > 0 ? `${it.unplayed_wins}-${it.unplayed_losses}` : '-',
            ])}
            empty="아직 대결 기록이 없습니다."
          />
          {rankItems.length > 20 && (
            <button type="button" onClick={() => setShowAll((v) => !v)}
              style={{ marginTop: '8px', background: 'none', border: 'none', color: '#667eea', cursor: 'pointer' }}>
              {showAll ? '접기' : `전체 ${rankItems.length}개 보기`}
            </button>
          )}
        </div>
      )}

      {insights && (
        <div style={CARD_STYLE}>
          <h4 style={{ margin: '0 0 4px', color: 'var(--admin-text-main)' }}>「안 해봄」 통계</h4>
          <div style={{ fontSize: '0.8rem', color: 'var(--admin-text-sub)', marginBottom: '8px' }}>
            칩을 한 번이라도 누른 판 {num(insights.marking_runs)}개 기준 · 표본 {insights.min_sample} 미만은 '-' ·
            인지도 = 해본 사람 비율, 호기심 승률 = 안 해본 채로 고른 비율, 경험자 승률 = 해본 사람 기준 승률
          </div>
          <Table
            head={['게임', '인지도', '호기심 승률', '경험자 승률', '신호']}
            rows={insightItems.map((it) => [
              it.name, pct(it.familiarity), pct(it.curiosity_rate), pct(it.experienced_rate),
              it.signal ? SIGNAL_LABEL[it.signal] ?? it.signal : '-',
            ])}
            empty="아직 표본이 모인 게임이 없습니다. 「안 해봄」 표시가 쌓이면 보입니다."
          />
        </div>
      )}
    </div>
  );
}
