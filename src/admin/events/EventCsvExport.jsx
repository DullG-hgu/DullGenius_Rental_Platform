// CSV 내보내기 — 컬럼 선택 + 미리보기 + 다운로드
import React, { useMemo, useState } from 'react';

const TIER_LABEL = { paid_member: '정회원', member: '준회원', non_member: '비회원', walk_in: '현장', invited: '초대' };
const STATUS_LABEL = {
  pending: '입금대기', paid: '입금완료', waitlisted: '대기자',
  cancelled_unpaid: '미입금만료', cancelled_self: '본인취소', cancelled_admin: '운영취소',
  refunded: '환불', no_show: '노쇼',
};
const fmt = (iso) => iso ? new Date(iso).toLocaleString('ko-KR') : '';

// [key, 헤더, getter(reg, event), 기본 선택]
const COLUMNS = [
  ['name', '이름', (r) => r.applicant_name || '', true],
  ['student_id', '학번', (r) => r.applicant_student_id || '', true],
  ['phone', '연락처', (r) => r.applicant_phone || '', true],
  ['tier', '회원등급', (r) => TIER_LABEL[r.membership_tier] || r.membership_tier, true],
  ['fee', '금액', (r) => String(r.fee_amount ?? 0), true],
  ['status', '상태', (r) => STATUS_LABEL[r.status] || r.status, true],
  ['team', '팀', (r) => r.team?.team_name || '', true],
  ['expected_depositor', '예상 입금자명', (r) => r.expected_depositor_name || '', true],
  ['actual_depositor', '실제 입금자명', (r) => r.actual_depositor_name || '', false],
  ['paid_at', '입금일시', (r) => fmt(r.payment_received_at), false],
  ['payment_deadline', '입금마감', (r) => fmt(r.payment_deadline_at), false],
  ['checked_in', '출석시각', (r) => fmt(r.checked_in_at), true],
  ['photo_consent', '사진동의', (r) => r.photo_consent ? 'Y' : 'N', false],
  ['privacy_consent', '개인정보동의', (r) => r.privacy_consent_at ? 'Y' : 'N', false],
  ['is_invited', '초대여부', (r) => r.is_invited ? 'Y' : 'N', false],
  ['created_at', '신청일시', (r) => fmt(r.created_at), false],
  ['cancelled_at', '취소일시', (r) => fmt(r.cancelled_at), false],
  ['cancel_reason', '취소사유', (r) => r.cancel_reason || '', false],
];

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function EventCsvExport({ event, registrations }) {
  const [selected, setSelected] = useState(() => new Set(COLUMNS.filter((c) => c[3]).map((c) => c[0])));
  const [statusFilter, setStatusFilter] = useState('active'); // all | active | paid
  const [extraQuestions, setExtraQuestions] = useState(true);

  const eqList = Array.isArray(event?.extra_questions) ? event.extra_questions : [];

  const rows = useMemo(() => {
    let base = registrations;
    if (statusFilter === 'active') base = base.filter((r) => ['pending', 'paid', 'waitlisted'].includes(r.status));
    else if (statusFilter === 'paid') base = base.filter((r) => r.status === 'paid');
    return base;
  }, [registrations, statusFilter]);

  const toggle = (key) => {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelected(next);
  };

  const buildCsv = () => {
    const cols = COLUMNS.filter((c) => selected.has(c[0]));
    const headers = cols.map((c) => c[1]);
    const lines = [headers];
    if (extraQuestions) eqList.forEach((q) => lines[0].push(`Q: ${q.label || q.id}`));

    rows.forEach((r) => {
      const row = cols.map((c) => c[2](r, event));
      if (extraQuestions) {
        const ans = r.extra_answers || {};
        eqList.forEach((q) => {
          const v = ans[q.id];
          row.push(Array.isArray(v) ? v.join('|') : (v ?? ''));
        });
      }
      lines.push(row);
    });
    return lines.map((line) => line.map(csvCell).join(',')).join('\r\n');
  };

  const download = () => {
    const csv = buildCsv();
    // BOM for Excel UTF-8 compatibility
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${event.slug || 'event'}_신청자_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const previewCsv = useMemo(() => {
    const csv = buildCsv();
    const lines = csv.split('\r\n');
    return lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n… (총 ${lines.length - 1}행)` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows, extraQuestions]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 좌측: 옵션 */}
        <div style={card}>
          <h4 style={h4}>1. 범위 선택</h4>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...input, width: '100%' }}>
            <option value="active">활성 신청만 ({registrations.filter((r) => ['pending', 'paid', 'waitlisted'].includes(r.status)).length}건)</option>
            <option value="paid">입금완료만 ({registrations.filter((r) => r.status === 'paid').length}건)</option>
            <option value="all">전체 ({registrations.length}건)</option>
          </select>

          <h4 style={{ ...h4, marginTop: 16 }}>2. 컬럼 선택</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {COLUMNS.map(([key, label]) => (
              <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 4, color: 'var(--admin-text-main)', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
                {label}
              </label>
            ))}
          </div>

          {eqList.length > 0 && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12, color: 'var(--admin-text-main)', fontSize: '0.9rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={extraQuestions} onChange={(e) => setExtraQuestions(e.target.checked)} />
              <span>추가 질문 답변 포함 ({eqList.length}개)</span>
            </label>
          )}
        </div>

        {/* 우측: 미리보기 */}
        <div style={card}>
          <h4 style={h4}>3. 미리보기 ({rows.length}행)</h4>
          <pre style={{
            background: 'var(--admin-bg)', color: 'var(--admin-text-main)',
            padding: 12, borderRadius: 4, fontSize: '0.75rem',
            overflow: 'auto', maxHeight: 320, margin: 0,
            fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre',
          }}>{previewCsv}</pre>
          <button onClick={download} disabled={rows.length === 0 || selected.size === 0} style={{ ...btnPrimary, marginTop: 12, width: '100%', padding: 12 }}>
            ⬇ CSV 다운로드 ({rows.length}행)
          </button>
          <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.75rem', marginTop: 8, marginBottom: 0 }}>
            Excel에서 한글이 깨지지 않도록 UTF-8 BOM이 자동 포함됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}

const card = { background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 16 };
const h4 = { margin: '0 0 8px', color: 'var(--admin-text-main)', fontSize: '0.95rem' };
const input = { padding: '8px 10px', background: 'var(--admin-bg)', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: '0.9rem' };
const btnPrimary = { padding: '6px 14px', background: 'var(--admin-primary)', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' };
