// 입금 매칭 — 입금 대기 목록 + 일괄 확인 + 미입금 만료
import React, { useState, useMemo } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { markPaid, expireUnpaid } from './api_events';

const fmt = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
const isExpired = (iso) => iso && new Date(iso) < new Date();

export default function EventPaymentReconcile({ event, registrations, reload }) {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const pending = useMemo(
    () => registrations
      .filter((r) => r.status === 'pending')
      .sort((a, b) => (a.payment_deadline_at || '').localeCompare(b.payment_deadline_at || '')),
    [registrations]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return pending;
    const q = search.trim().toLowerCase();
    return pending.filter((r) =>
      (r.applicant_name || '').toLowerCase().includes(q) ||
      (r.expected_depositor_name || '').toLowerCase().includes(q) ||
      (r.applicant_student_id || '').toLowerCase().includes(q)
    );
  }, [pending, search]);

  // 입금자명 일괄 매칭: 텍스트 한 줄에 입금자명 하나
  const matchedFromBulk = useMemo(() => {
    if (!bulkText.trim()) return new Map();
    const names = bulkText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
    const map = new Map(); // regId → 매칭된 입력 입금자명
    for (const name of names) {
      const n = norm(name);
      const hit = pending.find((r) => norm(r.expected_depositor_name) === n && !map.has(r.id));
      if (hit) map.set(hit.id, name);
    }
    return map;
  }, [bulkText, pending]);

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const selectMatched = () => {
    setSelected(new Set(matchedFromBulk.keys()));
  };

  const confirmOne = async (reg) => {
    setBusyId(reg.id);
    try {
      const actual = matchedFromBulk.get(reg.id) || null;
      await markPaid(reg.id, actual);
      showToast(`${reg.applicant_name} 입금 확인`, { type: 'success' });
      await reload();
    } catch (e) {
      showToast('실패: ' + e.message, { type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const confirmSelected = async () => {
    if (selected.size === 0) return showToast('선택된 항목이 없습니다.', { type: 'error' });
    if (!confirm(`${selected.size}건을 입금 완료로 처리합니다. 계속할까요?`)) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      try {
        const actual = matchedFromBulk.get(id) || null;
        await markPaid(id, actual);
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    setSelected(new Set());
    showToast(`완료: ${ok}건, 실패: ${fail}건`, { type: fail ? 'error' : 'success' });
    await reload();
  };

  const handleExpire = async () => {
    if (!confirm('마감 시간이 지난 미입금 신청을 모두 만료 처리합니다. 계속할까요?')) return;
    setBusy(true);
    try {
      const n = await expireUnpaid(event.id);
      showToast(`${n}건 만료 처리됨`, { type: 'success' });
      await reload();
    } catch (e) {
      showToast('실패: ' + e.message, { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 액션 바 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong style={{ color: 'var(--admin-text-main)' }}>입금 대기: {pending.length}건</strong>
        <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem' }}>
          (마감 지남: {pending.filter((r) => isExpired(r.payment_deadline_at)).length}건)
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleExpire} disabled={busy} style={btnDanger}>⏰ 미입금 만료 처리</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: 16 }}>
        {/* 좌측: 일괄 매칭 */}
        <div style={card}>
          <h4 style={h4}>📋 입금자명 붙여넣기</h4>
          <p style={hint}>은행 거래내역에서 입금자명만 줄바꿈으로 붙여넣으세요. 시스템이 등록 시 받은 "예상 입금자명"과 자동 매칭합니다.</p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'홍길동\n김철수\n이영희\n...'}
            rows={10}
            style={{ ...input, width: '100%', fontFamily: 'monospace', resize: 'vertical' }}
          />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem' }}>
              매칭됨: <strong style={{ color: '#27ae60' }}>{matchedFromBulk.size}</strong>건
            </span>
            <button onClick={selectMatched} disabled={matchedFromBulk.size === 0} style={btn}>매칭 항목 모두 선택</button>
          </div>
        </div>

        {/* 우측: 대기 목록 */}
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름·학번·입금자명 검색"
              style={{ ...input, flex: 1 }}
            />
            <button
              onClick={confirmSelected}
              disabled={busy || selected.size === 0}
              style={selected.size === 0 ? { ...btn, opacity: 0.5 } : btnPrimary}
            >
              ✓ 선택 {selected.size}건 입금 확인
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 32 }}>
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((r) => selected.has(r.id))}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) filtered.forEach((r) => next.add(r.id));
                        else filtered.forEach((r) => next.delete(r.id));
                        setSelected(next);
                      }}
                    />
                  </th>
                  <th style={th}>이름</th>
                  <th style={th}>예상 입금자명</th>
                  <th style={th}>금액</th>
                  <th style={th}>마감</th>
                  <th style={th}>매칭</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 30, color: 'var(--admin-text-sub)' }}>입금 대기 중인 신청이 없습니다.</td></tr>
                ) : filtered.map((r) => {
                  const matched = matchedFromBulk.has(r.id);
                  const expired = isExpired(r.payment_deadline_at);
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--admin-border)', background: matched ? 'rgba(39,174,96,0.08)' : undefined }}>
                      <td style={td}>
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      </td>
                      <td style={td}>{r.applicant_name}</td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{r.expected_depositor_name || '-'}</td>
                      <td style={td}>{(r.fee_amount || 0).toLocaleString()}</td>
                      <td style={{ ...td, color: expired ? '#e74c3c' : 'var(--admin-text-sub)', fontSize: '0.78rem' }}>
                        {fmt(r.payment_deadline_at)}{expired && ' ⚠'}
                      </td>
                      <td style={td}>
                        {matched ? <span style={{ color: '#27ae60', fontWeight: 600 }}>✓ 자동매칭</span> : <span style={{ color: 'var(--admin-text-sub)' }}>-</span>}
                      </td>
                      <td style={td}>
                        <button disabled={busyId === r.id} onClick={() => confirmOne(r)} style={btnSm}>입금확인</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const card = { background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 14 };
const h4 = { margin: '0 0 8px', color: 'var(--admin-text-main)', fontSize: '0.95rem' };
const hint = { margin: '0 0 8px', color: 'var(--admin-text-sub)', fontSize: '0.8rem', lineHeight: 1.5 };
const table = { width: '100%', borderCollapse: 'collapse' };
const th = { padding: '8px 10px', textAlign: 'left', color: 'var(--admin-text-sub)', fontSize: '0.75rem', fontWeight: 600, borderBottom: '1px solid var(--admin-border)' };
const td = { padding: '8px 10px', color: 'var(--admin-text-main)', fontSize: '0.85rem' };
const input = { padding: '8px 10px', background: 'var(--admin-bg)', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: '0.9rem' };
const btn = { padding: '6px 12px', background: 'transparent', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' };
const btnSm = { padding: '4px 8px', background: 'transparent', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' };
const btnPrimary = { padding: '6px 14px', background: 'var(--admin-primary)', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' };
const btnDanger = { padding: '6px 12px', background: 'transparent', color: 'var(--admin-danger, #e74c3c)', border: '1px solid var(--admin-danger, #e74c3c)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' };
