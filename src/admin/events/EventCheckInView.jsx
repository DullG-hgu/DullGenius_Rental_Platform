// 출석 체크 — 학번/이름 검색 + 1-탭 체크인
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { adminCheckIn } from './api_events';

const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';
const TIER_LABEL = { paid_member: '정회원', member: '준회원', non_member: '비회원', walk_in: '현장', invited: '초대' };

export default function EventCheckInView({ registrations, reload }) {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('eligible'); // eligible | all | checked
  const [busyId, setBusyId] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // 출석 가능: 입금완료 + 초대(무료) — 대기자/취소 제외
  const eligible = useMemo(
    () => registrations.filter((r) => r.status === 'paid' || (r.is_invited && r.status === 'paid')),
    [registrations]
  );

  const rows = useMemo(() => {
    let base = filter === 'all' ? registrations
             : filter === 'checked' ? eligible.filter((r) => r.checked_in_at)
             : eligible;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      base = base.filter((r) =>
        (r.applicant_name || '').toLowerCase().includes(q) ||
        (r.applicant_student_id || '').toLowerCase().includes(q) ||
        (r.applicant_phone || '').toLowerCase().includes(q)
      );
    }
    return base.sort((a, b) => {
      const av = a.checked_in_at ? 1 : 0;
      const bv = b.checked_in_at ? 1 : 0;
      if (av !== bv) return av - bv; // 미체크 먼저
      return (a.applicant_name || '').localeCompare(b.applicant_name || '', 'ko');
    });
  }, [registrations, eligible, search, filter]);

  const stats = useMemo(() => ({
    eligible: eligible.length,
    checked: eligible.filter((r) => r.checked_in_at).length,
  }), [eligible]);

  const checkIn = async (reg) => {
    if (reg.checked_in_at) return;
    if (reg.status !== 'paid') {
      if (!confirm(`${reg.applicant_name}님은 ${reg.status} 상태입니다. 그래도 출석 체크할까요?`)) return;
    }
    setBusyId(reg.id);
    try {
      await adminCheckIn(reg.id);
      showToast(`✓ ${reg.applicant_name} 출석`, { type: 'success' });
      setSearch(''); // 다음 사람을 위해 초기화
      inputRef.current?.focus();
      await reload();
    } catch (e) {
      showToast('실패: ' + e.message, { type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  // Enter — 검색 결과가 1건이면 그 사람 체크인
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && rows.length === 1 && !rows[0].checked_in_at) {
      e.preventDefault();
      checkIn(rows[0]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Stat label="출석 대상" n={stats.eligible} color="#3498db" />
        <Stat label="출석 완료" n={stats.checked} color="#27ae60" />
        <Stat label="남음" n={stats.eligible - stats.checked} color="#e67e22" />
        <div style={{ flex: 1 }} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={input}>
          <option value="eligible">출석 대상만</option>
          <option value="checked">출석 완료만</option>
          <option value="all">모든 신청</option>
        </select>
      </div>

      <div style={{ ...card, padding: 16 }}>
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="🔍 학번 또는 이름 입력 — 1명이면 Enter로 체크인"
          style={{ ...input, width: '100%', fontSize: '1.05rem', padding: '12px 14px' }}
        />
        <div style={{ marginTop: 6, color: 'var(--admin-text-sub)', fontSize: '0.78rem' }}>
          결과 {rows.length}건
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--admin-text-sub)' }}>
            {search ? '일치하는 신청자가 없습니다.' : '출석 대상이 없습니다.'}
          </div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>이름</th>
                <th style={th}>학번</th>
                <th style={th}>등급</th>
                <th style={th}>팀</th>
                <th style={th}>상태</th>
                <th style={th}>체크인</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--admin-border)', background: r.checked_in_at ? 'rgba(39,174,96,0.06)' : undefined }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.applicant_name}</td>
                  <td style={td}>{r.applicant_student_id || '-'}</td>
                  <td style={td}>{TIER_LABEL[r.membership_tier] || r.membership_tier}</td>
                  <td style={td}>{r.team?.team_name || <span style={{ color: 'var(--admin-text-sub)' }}>개인</span>}</td>
                  <td style={td}>{r.status}</td>
                  <td style={{ ...td, color: r.checked_in_at ? '#27ae60' : 'var(--admin-text-sub)' }}>
                    {r.checked_in_at ? `✓ ${fmt(r.checked_in_at)}` : '-'}
                  </td>
                  <td style={td}>
                    {r.checked_in_at ? (
                      <span style={{ color: '#27ae60', fontWeight: 600 }}>완료</span>
                    ) : (
                      <button disabled={busyId === r.id} onClick={() => checkIn(r)} style={btnPrimary}>
                        {busyId === r.id ? '...' : '✓ 출석'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, n, color }) {
  return (
    <div style={{ padding: '8px 14px', background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.8rem' }}>{label}</span>
      <strong style={{ color, fontSize: '1.1rem' }}>{n}</strong>
    </div>
  );
}

const card = { background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 8 };
const table = { width: '100%', borderCollapse: 'collapse' };
const th = { padding: '10px 12px', textAlign: 'left', color: 'var(--admin-text-sub)', fontSize: '0.78rem', fontWeight: 600, borderBottom: '1px solid var(--admin-border)' };
const td = { padding: '10px 12px', color: 'var(--admin-text-main)', fontSize: '0.9rem' };
const input = { padding: '8px 12px', background: 'var(--admin-bg)', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: '0.9rem' };
const btnPrimary = { padding: '8px 16px', background: 'var(--admin-primary)', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' };
