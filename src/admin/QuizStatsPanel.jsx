// 보드게임 성향검사 통계 (관리자 통계 탭 → 「성향검사 통계 보기」) — spec_fun_quiz.md §4
// 집계만 보여준다. 회원 개인의 결과는 서버가 내보내지 않는다. 기준: 기간 안에서 회원별 최신 1건.
import { useCallback, useEffect, useState } from 'react';
import { fetchQuizAdminStats } from '../api_fun';
import { DISPLAY } from '../fun/quiz/quizData';
import { familyName } from '../fun/quiz/quizLogic';

const CARD_STYLE = {
  background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)',
  borderRadius: '8px', padding: '16px',
};
const TH = { textAlign: 'left', padding: '8px 10px', color: 'var(--admin-text-sub)', fontWeight: 'normal', whiteSpace: 'nowrap' };
const TD = { padding: '8px 10px', color: 'var(--admin-text-main)', whiteSpace: 'nowrap' };
const PERIODS = [[7, '7일'], [30, '30일'], [120, '한 학기'], [0, '전체']];

const axisText = (v, d) => {
  const x = Number(v);
  if (Math.abs(x) < 0.25) return `둘 다 (${x.toFixed(2)})`;
  return `${x > 0 ? d.hi : d.lo} 쪽 (${x.toFixed(2)})`;
};

export default function QuizStatsPanel() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const from = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;
    fetchQuizAdminStats({ from })
      .then(setStats)
      .catch((e) => setError(e?.message || '성향검사 통계를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const codes = Object.entries(stats?.by_code ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div role="group" aria-label="기간" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {PERIODS.map(([key, text]) => (
          <button key={key} type="button" aria-pressed={days === key} onClick={() => setDays(key)}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--admin-border)', cursor: 'pointer',
              background: days === key ? '#667eea' : 'var(--admin-card-bg)',
              color: days === key ? '#fff' : 'var(--admin-text-main)',
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
        기간 안에서 회원마다 가장 최근 결과 1건만 셉니다. 개인별 결과는 볼 수 없습니다.
      </div>

      {error && <div role="alert" style={{ ...CARD_STYLE, color: '#e74c3c' }}>{error}</div>}

      {stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
            {[['응답 수', stats.responses], ['참여 회원', stats.members]].map(([label, value]) => (
              <div key={label} style={{ ...CARD_STYLE, textAlign: 'center' }}>
                <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.8rem', marginBottom: '6px' }}>{label}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--admin-text-main)' }}>{Number(value ?? 0).toLocaleString('ko-KR')}</div>
              </div>
            ))}
          </div>

          <div style={CARD_STYLE}>
            <div style={{ color: 'var(--admin-text-main)', fontWeight: 'bold', marginBottom: '8px' }}>동아리 평균 (4축)</div>
            {(stats.four_avg ?? []).length === 0
              ? <div style={{ color: 'var(--admin-text-sub)' }}>아직 응답이 없습니다.</div>
              : DISPLAY.map((d, i) => (
                <div key={d.name} style={{ color: 'var(--admin-text-main)', fontSize: '0.9rem', padding: '4px 0' }}>
                  {d.name}: {axisText(stats.four_avg[i], d)}
                </div>
              ))}
          </div>

          <div style={CARD_STYLE}>
            <div style={{ color: 'var(--admin-text-main)', fontWeight: 'bold', marginBottom: '8px' }}>유형별 인원</div>
            {codes.length === 0 ? (
              <div style={{ color: 'var(--admin-text-sub)' }}>아직 응답이 없습니다.</div>
            ) : (
              <div className="admin-table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--admin-border)' }}>
                      {['코드', '성향 이름', '인원'].map((h) => <th key={h} style={TH}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map(([code, n]) => (
                      <tr key={code} style={{ borderBottom: '1px solid var(--admin-border)' }}>
                        <td style={TD}>{code}</td>
                        <td style={TD}>{familyName(code)}</td>
                        <td style={TD}>{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
