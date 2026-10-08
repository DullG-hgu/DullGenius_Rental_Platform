// 머더미스터리 티어표 통계 (관리자 통계 탭 → 「머더 티어표 통계 보기」) — spec_fun_tier.md §9
// 집계만. 개인 표는 회원이 공개한 것만 공개 페이지에서 본다 (운영진이 비공개 표를 여는 경로 없음)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchTierAdminStats } from '../api_fun';

const CARD_STYLE = {
  background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)',
  borderRadius: '8px', padding: '16px',
};
const TH = { textAlign: 'left', padding: '8px 10px', color: 'var(--admin-text-sub)', fontWeight: 'normal', whiteSpace: 'nowrap' };
const TD = { padding: '8px 10px', color: 'var(--admin-text-main)', whiteSpace: 'nowrap' };
const TIERS = ['S', 'A', 'B', 'C', 'D'];
const toTier = (v) => (v == null ? '-' : v >= 4.5 ? 'S' : v >= 3.5 ? 'A' : v >= 2.5 ? 'B' : v >= 1.5 ? 'C' : 'D');
const SORTS = [['n', '평가 많은 순'], ['avg', '보정 평균 순'], ['zero', '평가 0 먼저']];

export default function TierStatsPanel() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('n');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTierAdminStats('murder')
      .then(setStats)
      .catch((e) => setError(e?.message || '티어표 통계를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const community = stats?.community;
  const minSample = community?.min_sample ?? 3;
  const items = useMemo(() => {
    const list = [...(community?.items ?? [])];
    if (sort === 'avg') list.sort((a, b) => (b.avg ?? -9) - (a.avg ?? -9) || b.n - a.n);
    else if (sort === 'zero') list.sort((a, b) => a.n - b.n || a.name.localeCompare(b.name, 'ko'));
    else list.sort((a, b) => b.n - a.n || (b.avg ?? -9) - (a.avg ?? -9));
    return list;
  }, [community, sort]);
  const zero = (community?.items ?? []).filter((i) => i.n === 0).length;
  const changed = (community?.items ?? []).filter((i) => i.n >= minSample && toTier(Number(i.raw_avg)) !== i.tier).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {SORTS.map(([key, text]) => (
          <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--admin-border)', cursor: 'pointer',
              background: sort === key ? '#667eea' : 'var(--admin-card-bg)',
              color: sort === key ? '#fff' : 'var(--admin-text-main)',
            }}>
            {text}
          </button>
        ))}
        <button type="button" onClick={load} disabled={loading}
          style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--admin-border)', background: 'var(--admin-card-bg)', color: 'var(--admin-text-main)', cursor: 'pointer' }}>
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--admin-text-sub)' }}>
        등급은 사람별 보정 후 평균 (tester 계정·탈퇴 회원 제외). 평가 {minSample}명 미만은 회원 화면에서 「모으는 중」.
        평가 0 = 그 머더를 해본 회원이 아직 없음.
      </div>

      {error && <div role="alert" style={{ ...CARD_STYLE, color: '#e74c3c' }}>{error}</div>}

      {stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
            {[
              ['티어표 연 회원', stats.lists],
              ['한 개 이상 평가', stats.participants],
              ['공개한 회원', stats.public],
              ['집계 평가자', community?.raters],
              ['전체 평균 점수', community?.global_mean != null ? Number(community.global_mean).toFixed(2) : '-'],
              ['평가 0 게임', zero],
              ['보정으로 등급 바뀜', changed],
            ].map(([label, value]) => (
              <div key={label} style={{ ...CARD_STYLE, textAlign: 'center' }}>
                <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.8rem', marginBottom: '6px' }}>{label}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--admin-text-main)' }}>
                  {typeof value === 'number' ? value.toLocaleString('ko-KR') : (value ?? 0)}
                </div>
              </div>
            ))}
          </div>

          <div style={CARD_STYLE}>
            <div style={{ color: 'var(--admin-text-main)', fontWeight: 'bold', marginBottom: '8px' }}>게임별 ({items.length}개)</div>
            <div className="admin-table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--admin-border)' }}>
                    {['게임', '평가', '등급(보정)', '원래 등급', '보정 평균', '원래 평균', '호불호', ...TIERS].map((h) => <th key={h} style={TH}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const raw = toTier(i.raw_avg == null ? null : Number(i.raw_avg));
                    const ready = i.n >= minSample;
                    return (
                      <tr key={i.id} style={{ borderBottom: '1px solid var(--admin-border)', opacity: i.n === 0 ? 0.55 : 1 }}>
                        <td style={{ ...TD, whiteSpace: 'normal', minWidth: '140px' }}>{i.name}</td>
                        <td style={TD}>{i.n}{!ready && i.n > 0 ? ' (모으는 중)' : ''}</td>
                        <td style={{ ...TD, fontWeight: 'bold' }}>{i.tier ?? '-'}</td>
                        <td style={{ ...TD, color: i.tier && raw !== i.tier ? '#f39c12' : TD.color }}>{raw}</td>
                        <td style={TD}>{i.avg != null ? Number(i.avg).toFixed(2) : '-'}</td>
                        <td style={TD}>{i.raw_avg != null ? Number(i.raw_avg).toFixed(2) : '-'}</td>
                        <td style={TD}>{i.split ? '갈림' : ''}</td>
                        {TIERS.map((t) => <td key={t} style={TD}>{i.dist?.[t] ?? 0}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
