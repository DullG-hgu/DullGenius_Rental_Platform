// 시스템 탭 「자동화 상태」 — DB 안 자동 작업(pg_cron)이 실제로 돌고 있는지 (읽기 전용)
// 2026-10-11: 찜 정리 자동화가 3개월간 초록불로 아무것도 안 한 사고 이후, 코드 없이 확인할 수 있게.
// GitHub Actions·Netlify 예약 함수는 DB에 기록이 없어 여기 안 보인다 — 화면에 명시한다.
import { useCallback, useEffect, useState } from 'react';
import { fetchCronStatus } from '../api';

const STATUS_LABEL = { succeeded: '성공', failed: '실패', running: '실행 중', starting: '시작 중' };

const fmt = (ts) => (ts
  ? new Date(ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

// cron 표기(UTC) → 한국 시간 설명. 흔한 두 형태만, 나머지는 원문
export function describeSchedule(schedule) {
  const parts = String(schedule || '').trim().split(/\s+/);
  if (parts.length !== 5) return schedule || '';
  const [m, h, dom, mon, dow] = parts;
  if (!/^\d+$/.test(m) || dom !== '*' || mon !== '*' || dow !== '*') return schedule;
  if (h === '*') return `매시 ${Number(m)}분`;
  if (/^\d+$/.test(h)) {
    const kst = (Number(h) + 9) % 24;
    return `매일 ${String(kst).padStart(2, '0')}:${String(Number(m)).padStart(2, '0')}`;
  }
  return schedule;
}

// cron 표기 → 예정 간격(ms). 판단 못 하는 표기는 null
export function expectedIntervalMs(schedule) {
  const parts = String(schedule || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  const every = /^\*\/(\d+)$/.exec(m);
  if (every && h === '*') return Number(every[1]) * 60 * 1000;
  if (!/^\d+$/.test(m)) return null;
  if (h === '*') return 60 * 60 * 1000;
  if (/^\d+$/.test(h)) return 24 * 60 * 60 * 1000;
  return null;
}

// 잡 하나의 상태 판정. 「성공」 기록이 있어도 예정 간격의 2배+10분 넘게 새 실행이 없으면 멈춤 의심
// (3개월간 초록불인 채 멈춰 있던 사고를 잡으려는 패널이라, 오래된 성공은 정상으로 치지 않는다)
export function jobHealth(job, now = Date.now()) {
  if (!job.active) return { key: 'off', label: '꺼짐', color: 'var(--admin-text-sub)' };
  if (job.last_status === 'failed') return { key: 'failed', label: '최근 실행 실패', color: '#e74c3c' };
  if (!job.last_start) return { key: 'unknown', label: '최근 기록 없음', color: '#f39c12' };
  const interval = expectedIntervalMs(job.schedule);
  const age = now - new Date(job.last_start).getTime();
  if (interval && age > interval * 2 + 10 * 60 * 1000) return { key: 'stale', label: '멈춤 의심', color: '#e67e22' };
  if (job.last_status === 'running' || job.last_status === 'starting') {
    return { key: 'running', label: '실행 중', color: '#3498db' };
  }
  if (job.last_status !== 'succeeded') return { key: 'unknown', label: '상태 확인 필요', color: '#f39c12' };
  if (!interval) return { key: 'ok', label: '최근 성공 (주기 판단 불가)', color: '#27ae60' };
  return { key: 'ok', label: '정상', color: '#27ae60' };
}

const CARD = {
  border: '1px solid var(--admin-border)', borderRadius: '8px', padding: '12px',
  background: 'var(--admin-card-bg)', display: 'flex', flexDirection: 'column', gap: '4px',
};
const SUB = { fontSize: '0.85em', color: 'var(--admin-text-sub)', overflowWrap: 'anywhere' };

export default function AutomationStatusPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchCronStatus(20));
    } catch (e) {
      console.error('[AutomationStatusPanel] 자동화 상태 조회 실패:', e);
      // 함수가 아직 운영 DB에 없을 때(PGRST202)는 안내만
      setError(e?.code === 'PGRST202' ? '자동화 상태 기능 준비 중 (DB 함수 미적용)' : `불러오기 실패: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const jobs = data?.jobs || [];
  const recent = data?.recent || [];

  return (
    <div className="admin-card" style={{ marginTop: '20px' }}>
      <div className="admin-btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>⏱ 자동화 상태</h4>
        <button type="button" className="admin-btn" onClick={load} disabled={loading}>
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>
      <p style={{ ...SUB, margin: '8px 0 12px' }}>
        DB 안에서 정해진 시각에 도는 자동 작업의 마지막 실행 결과.
        외부 자동화(GitHub Actions·Netlify 핑)는 여기 안 보임 — GitHub Actions 탭·Netlify 함수 로그에서 따로 확인.
      </p>

      {error && <div style={{ color: '#e74c3c', fontSize: '0.9em' }}>{error}</div>}
      {data && !data.available && <div style={SUB}>이 DB에는 자동 작업 기능(pg_cron)이 없음</div>}
      {data?.available && jobs.length === 0 && <div style={SUB}>등록된 자동 작업 없음</div>}

      <div className="admin-grid-auto" style={{ '--min': '240px' }}>
        {jobs.map((job) => {
          const health = jobHealth(job, data?.now ? new Date(data.now).getTime() : Date.now());
          return (
            <div key={job.jobid} style={{ ...CARD, borderLeft: `4px solid ${health.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--admin-text-main)', overflowWrap: 'anywhere' }}>{job.name || `작업 #${job.jobid}`}</strong>
                <span style={{ color: health.color, fontWeight: 600, fontSize: '0.9em' }}>{health.label}</span>
              </div>
              <div style={SUB}>주기: {describeSchedule(job.schedule)}</div>
              <div style={SUB}>
                마지막 실행: {fmt(job.last_start)}{job.last_status ? ` · ${STATUS_LABEL[job.last_status] || job.last_status}` : ''}
              </div>
              {job.last_fail_at && <div style={SUB}>마지막 실패: {fmt(job.last_fail_at)}</div>}
              {(job.last_message || job.last_fail_message) && (
                <div style={{ ...SUB, color: '#e74c3c' }}>{job.last_message || job.last_fail_message}</div>
              )}
            </div>
          );
        })}
      </div>

      {data?.available && (
        <p style={{ ...SUB, marginTop: '10px' }}>
          「멈춤 의심」 = 정해진 주기의 두 배 넘게 새 실행 없음. 「최근 기록 없음」 = 최근 {data.window}회 실행 기록 안에 이 작업이 한 번도 없음 — 둘 다 개발 담당자에게 확인 요청.
        </p>
      )}

      {recent.length > 0 && (
        <details style={{ marginTop: '10px' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--admin-text-main)', minHeight: '32px' }}>최근 실행 {recent.length}건</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            {recent.map((r) => (
              <div key={r.runid} style={{ ...SUB, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span>{fmt(r.start)}</span>
                <span style={{ color: 'var(--admin-text-main)' }}>{r.name || '—'}</span>
                <span style={{ color: r.status === 'failed' ? '#e74c3c' : 'inherit' }}>{STATUS_LABEL[r.status] || r.status}</span>
                {r.message && <span style={{ color: '#e74c3c' }}>{r.message}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
