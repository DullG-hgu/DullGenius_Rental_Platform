import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  fetchRentalRequests,
  confirmRentalRequest,
  rejectRentalRequest,
} from '../api';
import { useGameData } from '../contexts/GameDataContext';
import { useToast } from '../contexts/ToastContext';

const STATUS_LABEL = {
  pending: { text: '대기', bg: '#7f8c8d' },
  needs_review: { text: '검토 필요', bg: '#e67e22' },
  auto_confirmed: { text: '자동 확정', bg: '#27ae60' },
  manual_confirmed: { text: '수동 확정', bg: '#2ecc71' },
  rejected: { text: '반려', bg: '#c0392b' },
  cancelled: { text: '취소', bg: '#95a5a6' },
};

const ALL_STATUSES = Object.keys(STATUS_LABEL);
const DEFAULT_FILTER = ['needs_review', 'auto_confirmed', 'pending'];

const formatDateTime = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

const toLocalInputValue = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function StatusBadge({ status }) {
  const info = STATUS_LABEL[status] || { text: status, bg: '#34495e' };
  return (
    <span style={{
      background: info.bg, color: '#fff', padding: '2px 8px',
      borderRadius: 12, fontSize: '0.75rem', fontWeight: 600,
    }}>
      {info.text}
    </span>
  );
}

function RequestRow({ req, games, gamesById, onReview }) {
  const matchedNames = useMemo(
    () => (req.matched_game_ids || []).map((id) => gamesById.get(id)?.name).filter(Boolean),
    [req.matched_game_ids, gamesById]
  );

  const rawTokens = useMemo(
    () => (req.requested_games_raw || '').split(',').map((s) => s.trim()).filter(Boolean),
    [req.requested_games_raw]
  );

  const matchComplete = rawTokens.length > 0 && matchedNames.length === rawTokens.length;

  return (
    <div style={styles.row}>
      <div style={styles.rowHeader}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--admin-text-main)' }}>{req.requester_name}</strong>
          <span style={styles.sub}>{req.requester_phone}</span>
          <StatusBadge status={req.status} />
          {req.is_free && (
            <span style={{ ...styles.tag, background: '#3498db' }}>공익 무료</span>
          )}
        </div>
        <span style={styles.sub}>제출 {formatDateTime(req.submitted_at)}</span>
      </div>

      <div style={styles.grid}>
        <Field label="게임 원문">{req.requested_games_raw}</Field>
        <Field label={`매칭 (${matchedNames.length}/${rawTokens.length})`}>
          {matchedNames.length > 0 ? (
            <span style={{ color: matchComplete ? 'var(--admin-text-main)' : '#e74c3c' }}>
              {matchedNames.join(', ')}
            </span>
          ) : (
            <span style={{ color: '#e74c3c' }}>매칭 실패</span>
          )}
        </Field>
        <Field label="수령일">
          {req.pickup_at ? formatDateTime(req.pickup_at) : <span style={{ color: '#e74c3c' }}>파싱 실패</span>}
        </Field>
        <Field label="기간">{req.duration_days ? `${req.duration_days}일` : '-'}</Field>
        <Field label="비용">{req.rental_fee != null ? `${req.rental_fee.toLocaleString()}원` : '-'}</Field>
        <Field label="HOLD">
          {(req.hold_rental_ids || []).length > 0
            ? `${req.hold_rental_ids.length}건 생성됨`
            : '없음'}
        </Field>
      </div>

      {req.org_name && (
        <div style={styles.orgBlock}>
          <div><strong>단체:</strong> {req.org_name} ({req.org_type || '-'})</div>
          {req.event_overview && <div><strong>개요:</strong> {req.event_overview}</div>}
          {req.event_schedule && <div><strong>일정:</strong> {req.event_schedule}</div>}
          {req.audience_notes && <div><strong>참가자 특이사항:</strong> {req.audience_notes}</div>}
        </div>
      )}

      {req.review_note && (
        <div style={styles.reviewNote}>
          <strong>메모:</strong> {req.review_note}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        {['pending', 'needs_review', 'auto_confirmed'].includes(req.status) && (
          <button style={styles.btnPrimary} onClick={() => onReview(req)}>
            검토·수정
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={styles.fieldLabel}>{label}</div>
      <div style={styles.fieldValue}>{children}</div>
    </div>
  );
}

function ReviewModal({ req, games, gamesById, onClose, onRefresh }) {
  const { showToast } = useToast();
  const [selectedIds, setSelectedIds] = useState(() => req.matched_game_ids || []);
  const [pickupLocal, setPickupLocal] = useState(() => toLocalInputValue(req.pickup_at));
  const [duration, setDuration] = useState(req.duration_days || 1);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredGames = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games.slice(0, 30);
    return games.filter((g) => g.name?.toLowerCase().includes(q)).slice(0, 30);
  }, [games, query]);

  const toggleGame = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleConfirm = async () => {
    if (selectedIds.length === 0) {
      showToast('게임을 하나 이상 선택하세요.', { type: 'error' });
      return;
    }
    if (!pickupLocal) {
      showToast('수령일을 입력하세요.', { type: 'error' });
      return;
    }
    if (!duration || duration <= 0) {
      showToast('기간은 1일 이상이어야 합니다.', { type: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const pickupIso = new Date(pickupLocal).toISOString();
      const { data, error } = await confirmRentalRequest(req.id, selectedIds, pickupIso, duration);
      if (error) throw error;
      if (data && data.success === false) {
        showToast(data.message || '승인 실패', { type: 'error' });
        return;
      }
      showToast('승인 완료 — HOLD 생성됨', { type: 'success' });
      onRefresh();
      onClose();
    } catch (e) {
      console.error('[RentalRequests] confirm failed', e);
      showToast('승인 실패: ' + e.message, { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    const reason = window.prompt('반려 사유를 입력하세요 (필수)');
    if (!reason || !reason.trim()) return;
    setSubmitting(true);
    try {
      const { data, error } = await rejectRentalRequest(req.id, reason.trim());
      if (error) throw error;
      if (data && data.success === false) {
        showToast(data.message || '반려 실패', { type: 'error' });
        return;
      }
      showToast('반려 완료', { type: 'success' });
      onRefresh();
      onClose();
    } catch (e) {
      console.error('[RentalRequests] reject failed', e);
      showToast('반려 실패: ' + e.message, { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: 'var(--admin-text-main)' }}>대여 신청 검토</h3>
        <div style={{ fontSize: '0.85rem', color: 'var(--admin-text-sub)', marginBottom: 12 }}>
          {req.requester_name} · {req.requester_phone} · 제출 {formatDateTime(req.submitted_at)}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={styles.fieldLabel}>원문: {req.requested_games_raw}</div>
          <input
            type="text"
            placeholder="게임 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.input}
          />
          <div style={styles.gameList}>
            {filteredGames.map((g) => (
              <label key={g.id} style={styles.gameItem}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(g.id)}
                  onChange={() => toggleGame(g.id)}
                />
                <span>{g.name}</span>
              </label>
            ))}
          </div>
          <div style={{ ...styles.fieldLabel, marginTop: 8 }}>
            선택됨: {selectedIds.map((id) => gamesById.get(id)?.name).filter(Boolean).join(', ') || '없음'}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={styles.fieldLabel}>수령일시 (원문: {req.pickup_raw || '-'})</div>
            <input
              type="datetime-local"
              value={pickupLocal}
              onChange={(e) => setPickupLocal(e.target.value)}
              style={styles.input}
            />
          </div>
          <div>
            <div style={styles.fieldLabel}>기간 (일)</div>
            <input
              type="number"
              min={1}
              max={30}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              style={styles.input}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={styles.btnGhost} onClick={onClose} disabled={submitting}>취소</button>
          <button style={styles.btnDanger} onClick={handleReject} disabled={submitting}>반려</button>
          <button style={styles.btnPrimary} onClick={handleConfirm} disabled={submitting}>
            {submitting ? '처리 중…' : '승인 (HOLD 생성)'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RentalRequestsTab() {
  const { games } = useGameData();
  const { showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState(DEFAULT_FILTER);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(null);

  const gamesById = useMemo(() => {
    const m = new Map();
    (games || []).forEach((g) => m.set(g.id, g));
    return m;
  }, [games]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRentalRequests(statusFilter);
      setRequests(data || []);
    } catch (e) {
      console.error('[RentalRequests] load failed', e);
      showToast('신청 목록 로딩 실패', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, showToast]);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = (status) => {
    setStatusFilter((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={styles.toolbar}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              style={{
                ...styles.filterBtn,
                background: statusFilter.includes(s) ? STATUS_LABEL[s].bg : 'var(--admin-card-bg)',
                color: statusFilter.includes(s) ? '#fff' : 'var(--admin-text-sub)',
                borderColor: STATUS_LABEL[s].bg,
              }}
            >
              {STATUS_LABEL[s].text}
            </button>
          ))}
        </div>
        <button style={styles.btnGhost} onClick={load} disabled={loading}>
          {loading ? '로딩…' : '새로고침'}
        </button>
      </div>

      {loading && requests.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-text-sub)' }}>
          로딩 중…
        </div>
      ) : requests.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-text-sub)' }}>
          표시할 신청이 없습니다.
        </div>
      ) : (
        requests.map((req) => (
          <RequestRow
            key={req.id}
            req={req}
            games={games || []}
            gamesById={gamesById}
            onReview={setReviewing}
          />
        ))
      )}

      {reviewing && (
        <ReviewModal
          req={reviewing}
          games={games || []}
          gamesById={gamesById}
          onClose={() => setReviewing(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}

const styles = {
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, gap: 12, flexWrap: 'wrap',
  },
  filterBtn: {
    padding: '6px 12px', borderRadius: 16, fontSize: '0.8rem',
    border: '1px solid', cursor: 'pointer', fontWeight: 600,
  },
  row: {
    background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)',
    borderRadius: 8, padding: 14, marginBottom: 12, color: 'var(--admin-text-main)',
  },
  rowHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10, flexWrap: 'wrap', gap: 8,
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 10, marginBottom: 8,
  },
  fieldLabel: {
    fontSize: '0.72rem', color: 'var(--admin-text-sub)',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2,
  },
  fieldValue: { fontSize: '0.9rem', wordBreak: 'break-word' },
  sub: { fontSize: '0.8rem', color: 'var(--admin-text-sub)' },
  tag: {
    color: '#fff', padding: '2px 8px', borderRadius: 10,
    fontSize: '0.72rem', fontWeight: 600,
  },
  orgBlock: {
    background: 'var(--admin-bg)', border: '1px solid var(--admin-border)',
    borderRadius: 6, padding: 10, fontSize: '0.85rem', marginTop: 6,
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  reviewNote: {
    background: 'rgba(231, 126, 34, 0.1)', borderLeft: '3px solid #e67e22',
    padding: '6px 10px', marginTop: 8, fontSize: '0.85rem',
  },
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
  },
  modalContent: {
    background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)',
    color: 'var(--admin-text-main)', borderRadius: 10, padding: 20,
    width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
  },
  input: {
    width: '100%', padding: '8px 10px', background: 'var(--admin-bg)',
    color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)',
    borderRadius: 6, boxSizing: 'border-box',
  },
  gameList: {
    marginTop: 8, maxHeight: 200, overflowY: 'auto',
    border: '1px solid var(--admin-border)', borderRadius: 6,
    background: 'var(--admin-bg)',
  },
  gameItem: {
    display: 'flex', gap: 8, padding: '6px 10px', cursor: 'pointer',
    borderBottom: '1px solid var(--admin-border)', alignItems: 'center',
  },
  btnPrimary: {
    background: '#27ae60', color: '#fff', border: 'none',
    padding: '8px 16px', borderRadius: 6, fontWeight: 600, cursor: 'pointer',
  },
  btnDanger: {
    background: '#c0392b', color: '#fff', border: 'none',
    padding: '8px 16px', borderRadius: 6, fontWeight: 600, cursor: 'pointer',
  },
  btnGhost: {
    background: 'transparent', color: 'var(--admin-text-sub)',
    border: '1px solid var(--admin-border)', padding: '8px 16px',
    borderRadius: 6, cursor: 'pointer',
  },
};

export default RentalRequestsTab;
