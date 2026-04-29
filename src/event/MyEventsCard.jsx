// MyPage에 임베드되는 "내 행사 신청" 카드
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { listMyRegistrations, cancelMyRegistration } from './api_events_public';

const REG_STATUS = {
  pending: { label: '입금 대기', color: '#e67e22' },
  paid: { label: '입금 확인 ✓', color: '#27ae60' },
  waitlisted: { label: '대기자', color: '#3498db' },
  cancelled_unpaid: { label: '미입금 만료', color: '#7f8c8d' },
  cancelled_self: { label: '본인 취소', color: '#7f8c8d' },
  cancelled_admin: { label: '운영자 취소', color: '#7f8c8d' },
  refunded: { label: '환불 완료', color: '#7f8c8d' },
  no_show: { label: '노쇼', color: '#7f8c8d' },
};
const fmt = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';

export default function MyEventsCard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [regs, setRegs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      setRegs(await listMyRegistrations(user.id));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const handleCancel = async (reg) => {
    if (!confirm(`"${reg.events?.title}" 신청을 취소하시겠어요?`)) return;
    try {
      await cancelMyRegistration(reg.id);
      showToast('신청이 취소되었습니다.', { type: 'success' });
      load();
    } catch (e) {
      showToast('취소 실패: ' + e.message, { type: 'error' });
    }
  };

  if (!user) return null;
  if (loading) return null;
  if (regs.length === 0) return null;

  const active = regs.filter((r) => ['pending', 'paid', 'waitlisted'].includes(r.status));
  const past = regs.filter((r) => !['pending', 'paid', 'waitlisted'].includes(r.status));

  return (
    <div style={card}>
      <h3 style={h3}>🎪 내 행사 신청</h3>

      {active.map((r) => (
        <RegRow key={r.id} reg={r} onCancel={handleCancel} active />
      ))}

      {past.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', color: '#888', fontSize: '0.85rem' }}>지난 신청 {past.length}건</summary>
          <div style={{ marginTop: 8 }}>
            {past.map((r) => <RegRow key={r.id} reg={r} active={false} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function RegRow({ reg, onCancel, active }) {
  const ev = reg.events;
  const status = REG_STATUS[reg.status] || { label: reg.status, color: '#666' };
  if (!ev) return null;

  return (
    <div style={row}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {ev.hero_image_url && (
          <img src={ev.hero_image_url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/event/${ev.slug}`} style={{ color: '#fff', textDecoration: 'none', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {ev.title}
          </Link>
          <div style={{ fontSize: '0.8rem', color: '#aaa', marginTop: 2 }}>
            {fmt(ev.event_start_at)}{ev.location ? ` · ${ev.location}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ background: status.color, color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>{status.label}</span>
            {reg.fee_amount > 0 && <span style={{ fontSize: '0.78rem', color: '#aaa' }}>{reg.fee_amount.toLocaleString()}원</span>}
            {reg.status === 'pending' && reg.payment_deadline_at && (
              <span style={{ fontSize: '0.75rem', color: '#e67e22' }}>마감 {fmt(reg.payment_deadline_at)}</span>
            )}
          </div>
        </div>
        {active && reg.status === 'pending' && (
          <button onClick={() => onCancel(reg)} style={cancelBtn} type="button">취소</button>
        )}
      </div>
    </div>
  );
}

const card = {
  background: '#1f1f1f',
  border: '1px solid #333',
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  color: '#fff',
};
const h3 = { margin: '0 0 12px', fontSize: '1rem', color: '#fff' };
const row = { padding: '12px 0', borderTop: '1px solid #2a2a2a' };
const cancelBtn = {
  padding: '4px 10px',
  background: 'transparent',
  border: '1px solid #555',
  borderRadius: 6,
  color: '#aaa',
  fontSize: '0.78rem',
  cursor: 'pointer',
  flexShrink: 0,
};
