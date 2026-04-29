// 신청자 명단 — 필터·검색·액션 통합 테이블
import React, { useState, useMemo } from 'react';
import { useToast } from '../../contexts/ToastContext';
import {
  markPaid, unmarkPaid, adminCheckIn, adminCancel, adminRefund,
  promoteWaitlist, adminInviteUser, adminRegister, searchProfiles,
} from './api_events';

const STATUS_LABEL = {
  pending: { text: '입금대기', bg: '#e67e22' },
  paid: { text: '입금완료', bg: '#27ae60' },
  waitlisted: { text: '대기자', bg: '#3498db' },
  cancelled_unpaid: { text: '미입금만료', bg: '#7f8c8d' },
  cancelled_self: { text: '본인취소', bg: '#7f8c8d' },
  cancelled_admin: { text: '운영취소', bg: '#7f8c8d' },
  refunded: { text: '환불', bg: '#95a5a6' },
  no_show: { text: '노쇼', bg: '#34495e' },
};
const TIER_LABEL = { paid_member: '정회원', member: '준회원', non_member: '비회원', walk_in: '현장', invited: '초대' };

const fmt = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';

export default function EventRegistrationsView({ event, registrations, teams, reload }) {
  const { showToast } = useToast();
  const [filter, setFilter] = useState('all'); // all | active | pending | paid | waitlisted | cancelled
  const [teamFilter, setTeamFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false); // 'register' | 'invite' | null

  const filtered = useMemo(() => {
    let rows = registrations;
    if (filter === 'active') rows = rows.filter((r) => ['pending', 'paid', 'waitlisted'].includes(r.status));
    else if (filter === 'cancelled') rows = rows.filter((r) => r.status.startsWith('cancelled') || r.status === 'refunded' || r.status === 'no_show');
    else if (filter !== 'all') rows = rows.filter((r) => r.status === filter);
    if (teamFilter !== 'all') {
      rows = teamFilter === 'individual' ? rows.filter((r) => !r.team_id) : rows.filter((r) => r.team_id === teamFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        (r.applicant_name || '').toLowerCase().includes(q) ||
        (r.applicant_student_id || '').toLowerCase().includes(q) ||
        (r.applicant_phone || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [registrations, filter, teamFilter, search]);

  const counts = useMemo(() => ({
    pending: registrations.filter((r) => r.status === 'pending').length,
    paid: registrations.filter((r) => r.status === 'paid').length,
    waitlisted: registrations.filter((r) => r.status === 'waitlisted').length,
    cancelled: registrations.filter((r) => r.status.startsWith('cancelled') || r.status === 'refunded' || r.status === 'no_show').length,
  }), [registrations]);

  const wrap = async (id, label, fn) => {
    setBusy(id);
    try {
      await fn();
      showToast(`${label} 완료`, { type: 'success' });
      await reload();
    } catch (e) {
      showToast(`${label} 실패: ${e.message}`, { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 상단 통계 + 액션 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Stat label="입금대기" n={counts.pending} color="#e67e22" />
        <Stat label="입금완료" n={counts.paid} color="#27ae60" />
        <Stat label="대기자" n={counts.waitlisted} color="#3498db" />
        <Stat label="취소/환불" n={counts.cancelled} color="#7f8c8d" />
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAddModal('register')} style={btnPrimary}>+ 수동 등록</button>
        <button onClick={() => setShowAddModal('invite')} style={btn}>🎁 무료 초대</button>
      </div>

      {/* 필터 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 12, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 8 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={input}>
          <option value="all">전체 ({registrations.length})</option>
          <option value="active">활성 ({counts.pending + counts.paid + counts.waitlisted})</option>
          <option value="pending">입금대기 ({counts.pending})</option>
          <option value="paid">입금완료 ({counts.paid})</option>
          <option value="waitlisted">대기자 ({counts.waitlisted})</option>
          <option value="cancelled">취소·환불 ({counts.cancelled})</option>
        </select>
        {teams.length > 0 && (
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={input}>
            <option value="all">모든 팀/개인</option>
            <option value="individual">개인 신청만</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
          </select>
        )}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름/학번/연락처 검색" style={{ ...input, flex: 1, minWidth: 200 }} />
      </div>

      {/* 테이블 */}
      <div style={{ overflowX: 'auto', background: 'var(--admin-card-bg)', borderRadius: 8 }}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>이름</th>
              <th style={th}>학번</th>
              <th style={th}>연락처</th>
              <th style={th}>등급</th>
              <th style={th}>팀</th>
              <th style={th}>금액</th>
              <th style={th}>상태</th>
              <th style={th}>입금자명</th>
              <th style={th}>출석</th>
              <th style={th}>액션</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: 40, color: 'var(--admin-text-sub)' }}>해당 조건의 신청자가 없습니다.</td></tr>
            ) : filtered.map((r) => {
              const status = STATUS_LABEL[r.status] || { text: r.status, bg: '#666' };
              return (
                <tr key={r.id} style={{ borderTop: '1px solid var(--admin-border)' }}>
                  <td style={td}>
                    <div>{r.applicant_name}</div>
                    {r.is_invited && <span style={{ fontSize: '0.7rem', color: '#9b59b6' }}>초대</span>}
                  </td>
                  <td style={td}>{r.applicant_student_id || '-'}</td>
                  <td style={td}>{r.applicant_phone || '-'}</td>
                  <td style={td}>{TIER_LABEL[r.membership_tier] || r.membership_tier}</td>
                  <td style={td}>{r.team?.team_name || <span style={{ color: 'var(--admin-text-sub)' }}>개인</span>}</td>
                  <td style={td}>{(r.fee_amount || 0).toLocaleString()}</td>
                  <td style={td}>
                    <span style={{ background: status.bg, color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem' }}>{status.text}</span>
                    {r.status === 'pending' && r.payment_deadline_at && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-sub)', marginTop: 4 }}>~{fmt(r.payment_deadline_at)}</div>
                    )}
                  </td>
                  <td style={td}>
                    <div style={{ fontSize: '0.78rem' }}>{r.expected_depositor_name || '-'}</div>
                    {r.actual_depositor_name && r.actual_depositor_name !== r.expected_depositor_name && (
                      <div style={{ fontSize: '0.7rem', color: '#e67e22' }}>실: {r.actual_depositor_name}</div>
                    )}
                  </td>
                  <td style={td}>{r.checked_in_at ? '✓' : '-'}</td>
                  <td style={td}>
                    <RowActions reg={r} busy={busy === r.id} onAction={wrap} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAddModal === 'register' && (
        <ManualAddModal mode="register" event={event} teams={teams} onClose={() => setShowAddModal(null)} onDone={() => { setShowAddModal(null); reload(); }} />
      )}
      {showAddModal === 'invite' && (
        <ManualAddModal mode="invite" event={event} onClose={() => setShowAddModal(null)} onDone={() => { setShowAddModal(null); reload(); }} />
      )}
    </div>
  );
}

function RowActions({ reg, busy, onAction }) {
  const s = reg.status;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {s === 'pending' && (
        <button disabled={busy} onClick={() => onAction(reg.id, '입금확인', () => markPaid(reg.id))} style={btnSm}>입금확인</button>
      )}
      {s === 'paid' && (
        <>
          <button disabled={busy} onClick={() => onAction(reg.id, '입금취소', () => unmarkPaid(reg.id))} style={btnSm}>입금취소</button>
          <button disabled={busy} onClick={() => onAction(reg.id, '환불처리', () => adminRefund(reg.id))} style={btnSm}>환불</button>
        </>
      )}
      {s === 'waitlisted' && (
        <button disabled={busy} onClick={() => onAction(reg.id, '대기자 승계', () => promoteWaitlist(reg.id))} style={btnSm}>승계</button>
      )}
      {['pending', 'paid', 'waitlisted'].includes(s) && (
        <button disabled={busy} onClick={() => {
          const reason = prompt('취소 사유 (선택)');
          if (reason === null) return;
          onAction(reg.id, '운영자 취소', () => adminCancel(reg.id, reason || null));
        }} style={{ ...btnSm, color: 'var(--admin-danger)' }}>취소</button>
      )}
    </div>
  );
}

// === 수동 등록 / 초대 모달 ===
function ManualAddModal({ mode, event, teams = [], onClose, onDone }) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [tier, setTier] = useState(''); // null이면 자동 판정
  const [teamId, setTeamId] = useState('');
  const [markPaidFlag, setMarkPaidFlag] = useState(false);
  const [depositor, setDepositor] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const doSearch = async (e) => {
    e?.preventDefault();
    if (query.trim().length < 2) return showToast('2자 이상 검색어 필요', { type: 'error' });
    setSearching(true);
    try {
      setResults(await searchProfiles(query));
    } catch (e) {
      showToast('검색 실패: ' + e.message, { type: 'error' });
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    if (!picked) return showToast('회원을 먼저 선택하세요.', { type: 'error' });
    setBusy(true);
    try {
      if (mode === 'invite') {
        await adminInviteUser(event.id, picked.id, note || null);
        showToast(`${picked.name} 초대 완료`, { type: 'success' });
      } else {
        if (tier === 'walk_in' && event.allow_walk_in === false) {
          return showToast('이 행사는 현장 등록이 비활성화되어 있습니다.', { type: 'error' });
        }
        await adminRegister(event.id, picked.id, {
          membershipTier: tier || null,
          teamId: teamId || null,
          markPaid: markPaidFlag,
          actualDepositorName: depositor || null,
          note: note || null,
        });
        showToast(`${picked.name} 등록 완료`, { type: 'success' });
      }
      onDone();
    } catch (e) {
      const m = e.message || '';
      if (m.includes('already_registered')) showToast('이미 신청된 사용자입니다.', { type: 'error' });
      else if (m.includes('walk_in_not_allowed')) showToast('현장 등록이 비활성화되어 있습니다.', { type: 'error' });
      else showToast('실패: ' + m, { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'invite' ? '🎁 무료 초대' : '+ 수동 등록'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <form onSubmit={doSearch} style={{ display: 'flex', gap: 6 }}>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 또는 학번 검색" style={{ ...modalInput, flex: 1 }} />
          <button type="submit" disabled={searching} style={btn}>{searching ? '...' : '검색'}</button>
        </form>
        {results.length > 0 && !picked && (
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: 4 }}>
            {results.map((p) => (
              <button key={p.id} type="button" onClick={() => setPicked(p)} style={{ display: 'block', width: '100%', padding: 8, background: 'transparent', border: 'none', borderBottom: '1px solid var(--admin-border)', color: 'var(--admin-text-main)', textAlign: 'left', cursor: 'pointer' }}>
                <strong>{p.name}</strong> <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem' }}>{p.student_id} · {p.phone || '-'}{p.is_paid ? ' · 회비O' : ''}</span>
              </button>
            ))}
          </div>
        )}
        {picked && (
          <div style={{ padding: 10, background: 'var(--admin-bg)', border: '1px solid var(--admin-primary)', borderRadius: 4 }}>
            선택: <strong>{picked.name}</strong> ({picked.student_id})
            <button type="button" onClick={() => setPicked(null)} style={{ marginLeft: 10, ...btnSm }}>변경</button>
          </div>
        )}

        {picked && mode === 'register' && (
          <>
            <label style={modalField}>
              <span>회원 등급 (비우면 자동 판정)</span>
              <select value={tier} onChange={(e) => setTier(e.target.value)} style={modalInput}>
                <option value="">자동 판정 (회비 납부 여부로)</option>
                <option value="paid_member">정회원</option>
                <option value="non_member">비회원</option>
                <option value="walk_in">현장결제</option>
              </select>
            </label>
            {teams.length > 0 && (
              <label style={modalField}>
                <span>팀 배정 (선택)</span>
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={modalInput}>
                  <option value="">개인 등록</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
                </select>
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={markPaidFlag} onChange={(e) => setMarkPaidFlag(e.target.checked)} />
              <span style={{ fontSize: '0.9rem' }}>입금 완료로 처리 (현장 받은 돈)</span>
            </label>
            {markPaidFlag && (
              <label style={modalField}>
                <span>실제 입금자명 (선택)</span>
                <input value={depositor} onChange={(e) => setDepositor(e.target.value)} style={modalInput} />
              </label>
            )}
          </>
        )}
        <label style={modalField}>
          <span>메모 (선택)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="현장 등록 사유 등" style={modalInput} />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={btn}>취소</button>
          <button type="button" disabled={busy || !picked} onClick={submit} style={btnPrimary}>{busy ? '처리 중…' : (mode === 'invite' ? '초대하기' : '등록하기')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 24, width: '100%', maxWidth: 520, color: 'var(--admin-text-main)' }}>
        <h3 style={{ margin: '0 0 16px' }}>{title}</h3>
        {children}
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

const table = { width: '100%', borderCollapse: 'collapse' };
const th = { padding: '10px 12px', textAlign: 'left', color: 'var(--admin-text-sub)', fontSize: '0.78rem', fontWeight: 600, borderBottom: '1px solid var(--admin-border)' };
const td = { padding: '10px 12px', color: 'var(--admin-text-main)', fontSize: '0.85rem', verticalAlign: 'top' };
const input = { padding: '6px 10px', background: 'var(--admin-bg)', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: '0.85rem' };
const btn = { padding: '6px 12px', background: 'transparent', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' };
const btnSm = { padding: '4px 8px', background: 'transparent', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem' };
const btnPrimary = { padding: '6px 14px', background: 'var(--admin-primary)', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' };
const modalInput = { padding: '8px 10px', background: 'var(--admin-bg)', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: '0.9rem' };
const modalField = { display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--admin-text-sub)', fontSize: '0.85rem' };
