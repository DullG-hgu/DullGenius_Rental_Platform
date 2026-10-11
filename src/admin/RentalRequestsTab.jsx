import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  fetchRentalRequests,
  confirmRentalRequest,
  rejectRentalRequest,
  cancelRentalRequest,
  returnRentalRequest,
} from '../api';
import { useGameData } from '../contexts/GameDataContext';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from '../components/ConfirmModal';

const STATUS_LABEL = {
  pending: { text: '대기', bg: '#7f8c8d' },
  needs_review: { text: '검토 필요', bg: '#e67e22' },
  auto_confirmed: { text: '자동 확정', bg: '#27ae60' },
  manual_confirmed: { text: '수동 확정', bg: '#2ecc71' },
  rejected: { text: '반려', bg: '#c0392b' },
  cancelled: { text: '취소', bg: '#95a5a6' },
  returned: { text: '반납 완료', bg: '#34495e' }, // 신청 단위 반납 (return_rental_request). 기본 필터에는 넣지 않는다
};

const ALL_STATUSES = Object.keys(STATUS_LABEL);
// 확정 건(auto/manual)은 관리자가 반납해야 끝나므로 기본 화면에 둔다
const DEFAULT_FILTER = ['needs_review', 'auto_confirmed', 'manual_confirmed', 'pending'];
// 「검토·수정」을 여는 상태. 확정 건(auto/manual_confirmed)도 다시 열어 게임·수령일·기간을 고치거나 반려한다
// (confirm_rental_request 가 재확정을 받고, 열린 HOLD 가 없으면 '이미 종료된 대여입니다'를 돌려준다)
const REVIEWABLE = ['pending', 'needs_review', 'auto_confirmed', 'manual_confirmed'];
const CONFIRMED = ['auto_confirmed', 'manual_confirmed'];

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

// onReturn/onCancel: 확정 건 카드의 「반납」·「취소」 (확인은 부모의 ConfirmModal)
function RequestRow({ req, games, gamesById, onReview, onReturn, onCancel }) {
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
            <span style={{ color: '#e74c3c' }} title="원문에서 게임 식별 실패 — 검토·수정에서 수동 선택 필요">
              매칭 실패 (수동 선택 필요)
            </span>
          )}
        </Field>
        <Field label="수령일">
          {req.pickup_at ? formatDateTime(req.pickup_at) : (
            <span style={{ color: '#e74c3c' }} title="원문 수령일을 자동 해석하지 못함 — 검토·수정에서 직접 입력 필요">
              날짜 해석 실패 (직접 입력 필요)
            </span>
          )}
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

      <div className="admin-btn-row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        {CONFIRMED.includes(req.status) && (
          <>
            {/* 상태 칩 「취소」(cancelled)·반려와 헷갈리지 않게 「신청 취소」 */}
            <button style={styles.btnGhost} onClick={() => onCancel(req)}>신청 취소</button>
            <button style={styles.btnReturn} onClick={() => onReturn(req)}>반납</button>
          </>
        )}
        {REVIEWABLE.includes(req.status) && (
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

  const isConfirmed = CONFIRMED.includes(req.status);
  // 수령 후 확정 건은 게임 목록·수령일을 못 바꾸고 기간만 조정한다
  // (DB 도 '수령 후 게임·수령일 변경 불가 — 기간만 조정'으로 막는다. 수령일은 원래 값을 그대로 보내 분 단위 비교를 통과)
  const pickedUp = isConfirmed && !!req.pickup_at && new Date(req.pickup_at).getTime() <= Date.now();

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
        showToast(data.message || (isConfirmed ? '변경 저장 실패' : '승인 실패'), { type: 'error' });
        return;
      }
      showToast(isConfirmed ? '변경 저장 완료' : '승인 완료 — HOLD 생성됨', { type: 'success' });
      onRefresh();
      onClose();
    } catch (e) {
      console.error('[RentalRequests] confirm failed', e);
      showToast((isConfirmed ? '변경 저장 실패: ' : '승인 실패: ') + e.message, { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // 반려 사유는 이 모달 안에서 바로 받는다.
  // 예전엔 PromptModal 을 이 오버레이(onClick=닫기) 안에 그려서, 사유 입력칸을 누르는 클릭이 오버레이까지
  // 올라가 검토 모달째 닫혔다 — 반려를 끝낼 수 없었다. window.prompt 는 모바일 대화상자 차단에 걸린다.
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const rejectInputRef = useRef(null);

  useEffect(() => {
    if (rejectOpen) rejectInputRef.current?.focus();
  }, [rejectOpen]);

  // 오버레이 닫기: 누르기 시작과 끝이 모두 오버레이 자체일 때만 (모달 안에서 시작한 드래그·선택이 밖에서 끝나도 안 닫힘).
  // 작성 중인 반려 사유가 있으면 닫지 않는다.
  const overlayPressRef = useRef(false);
  const handleOverlayPointerUp = (e) => {
    const onOverlay = overlayPressRef.current && e.target === e.currentTarget;
    overlayPressRef.current = false;
    if (!onOverlay || submitting || rejectReason.trim()) return;
    onClose();
  };

  const submitReject = async () => {
    const reason = rejectReason;
    if (!reason.trim()) {
      showToast('반려 사유를 입력해야 합니다.', { type: 'warning' });
      rejectInputRef.current?.focus();
      return;
    }
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
    <div
      style={styles.modalOverlay}
      onPointerDown={(e) => { overlayPressRef.current = e.target === e.currentTarget; }}
      onPointerUp={handleOverlayPointerUp}
      onPointerCancel={() => { overlayPressRef.current = false; }}
    >
      <div className="admin-modal-scroll" style={styles.modalContent} role="dialog" aria-modal="true" aria-label="대여 신청 검토">
        <h3 style={{ marginTop: 0, color: 'var(--admin-text-main)' }}>{isConfirmed ? '확정 건 수정' : '대여 신청 검토'}</h3>
        <div style={{ fontSize: '0.85rem', color: 'var(--admin-text-sub)', marginBottom: 12 }}>
          {req.requester_name} · {req.requester_phone} · 제출 {formatDateTime(req.submitted_at)}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={styles.fieldLabel}>원문: {req.requested_games_raw}</div>
          {pickedUp ? (
            <div style={styles.lockNote}>수령 후 — 게임·수령일 변경 불가, 기간만 조정</div>
          ) : (
            <>
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
            </>
          )}
          <div style={{ ...styles.fieldLabel, marginTop: 8 }}>
            선택됨: {selectedIds.map((id) => gamesById.get(id)?.name).filter(Boolean).join(', ') || '없음'}
          </div>
        </div>

        <div className="admin-grid-auto" style={{ '--min': '160px', marginBottom: 16 }}>
          <div>
            <div style={styles.fieldLabel}>수령일시 (원문: {req.pickup_raw || '-'})</div>
            <input
              type="datetime-local"
              value={pickupLocal}
              onChange={(e) => setPickupLocal(e.target.value)}
              disabled={pickedUp}
              aria-label="수령일시"
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

        {rejectOpen ? (
          <div style={styles.rejectBox}>
            <label htmlFor={`reject-reason-${req.id}`} style={styles.fieldLabel}>반려 사유 (필수 · 신청자에게 전달)</label>
            <textarea
              id={`reject-reason-${req.id}`}
              ref={rejectInputRef}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="예: 요청 기간에 이미 예약된 게임"
              rows={3}
              style={{ ...styles.input, resize: 'vertical' }}
            />
            <div className="admin-btn-row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button style={styles.btnGhost} onClick={() => { setRejectOpen(false); setRejectReason(''); }} disabled={submitting}>
                반려 취소
              </button>
              <button style={styles.btnDanger} onClick={submitReject} disabled={submitting}>
                {submitting ? '처리 중…' : '반려 확정'}
              </button>
            </div>
          </div>
        ) : (
          <div className="admin-btn-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button style={styles.btnGhost} onClick={onClose} disabled={submitting}>닫기</button>
            <button style={styles.btnDanger} onClick={() => setRejectOpen(true)} disabled={submitting}>반려</button>
            <button style={styles.btnPrimary} onClick={handleConfirm} disabled={submitting}>
              {submitting ? '처리 중…' : isConfirmed ? '변경 저장' : '승인 (HOLD 생성)'}
            </button>
          </div>
        )}
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
  // 확정 건 반납·취소 확인 — { kind: 'return'|'cancel', req }
  const [lifecycle, setLifecycle] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

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

  // 실패는 DB 메시지를 그대로 보여 준다 ('수령 전 — 취소로 처리', '열린 대여 없음' 등)
  const runLifecycle = async () => {
    const { kind, req } = lifecycle || {};
    if (!req) return;
    try {
      const { data, error } = kind === 'return'
        ? await returnRentalRequest(req.id)
        : await cancelRentalRequest(req.id, cancelReason.trim() || null);
      if (error) throw error;
      if (data && data.success === false) {
        showToast(data.message || (kind === 'return' ? '반납 실패' : '취소 실패'), { type: 'error' });
        return;
      }
      if (kind === 'return') {
        showToast(data?.overdue_days > 0 ? `반납 완료 — 단체 연체 ${data.overdue_days}일` : '반납 완료', { type: 'success' });
      } else {
        showToast('신청 취소 완료', { type: 'success' });
      }
      load();
    } catch (e) {
      console.error('[RentalRequests] lifecycle failed', e);
      showToast((kind === 'return' ? '반납 실패: ' : '취소 실패: ') + (e?.message || String(e)), { type: 'error' });
    }
  };

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
            onReturn={(r) => setLifecycle({ kind: 'return', req: r })}
            onCancel={(r) => { setCancelReason(''); setLifecycle({ kind: 'cancel', req: r }); }}
          />
        ))
      )}

      <ConfirmModal
        isOpen={!!lifecycle}
        onClose={() => setLifecycle(null)}
        onConfirm={runLifecycle}
        title={lifecycle?.kind === 'return' ? '단체 대여 반납' : '단체 대여 신청 취소'}
        message={lifecycle?.kind === 'return'
          ? `[${lifecycle?.req?.requester_name}] 신청의 게임 전부를 반납 처리합니다. (부분 반납 없음)`
          : `[${lifecycle?.req?.requester_name}] 신청을 취소하고 잡혀 있는 게임을 모두 풉니다. 반려와 별개.`}
        confirmText={lifecycle?.kind === 'return' ? '반납' : '신청 취소'}
        cancelText="닫기"
        type={lifecycle?.kind === 'return' ? 'info' : 'warning'}
        initialFocus={lifecycle?.kind === 'cancel' ? 'firstInput' : 'first'}
        subContent={lifecycle?.kind === 'cancel' ? (
          <label style={{ display: 'block', marginTop: 8 }}>
            <span style={styles.fieldLabel}>취소 사유 (선택)</span>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
              placeholder="예: 행사 취소"
              style={{ ...styles.input, resize: 'vertical' }}
            />
          </label>
        ) : null}
      />

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
    padding: '8px 12px', borderRadius: 16, fontSize: '0.8rem',
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
  btnReturn: {
    background: '#2980b9', color: '#fff', border: 'none',
    padding: '8px 16px', borderRadius: 6, fontWeight: 600, cursor: 'pointer',
  },
  lockNote: {
    padding: '10px 12px', borderRadius: 6, fontSize: '0.85rem',
    background: 'var(--admin-bg)', border: '1px dashed var(--admin-border)', color: 'var(--admin-text-sub)',
  },
  rejectBox: {
    border: '1px solid #c0392b', borderRadius: 8, padding: 12,
    background: 'rgba(192, 57, 43, 0.08)',
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
    width: '100%', maxWidth: 560,
    // maxHeight/overflow 는 .admin-modal-scroll (dvh 대응)
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
