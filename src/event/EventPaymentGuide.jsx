// 결제 안내 카드 — Apply Done / EventPage / MyPage 공용
import React from 'react';
import { useToast } from '../contexts/ToastContext';

const fmtDeadline = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function EventPaymentGuide({ event, reg }) {
  const { showToast } = useToast();
  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    showToast(`${label} 복사됨`, { type: 'success' });
  };

  return (
    <section className="event-section" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <h2><span className="icon">💳</span> 입금 안내</h2>

      <div style={amountBox}>
        <div style={{ fontSize: '0.8rem', color: 'var(--event-text-sub)' }}>입금 금액</div>
        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--event-accent)', fontFeatureSettings: '"tnum"' }}>
          {(reg.fee_amount || 0).toLocaleString()}원
        </div>
        {reg.payment_deadline_at && (
          <div style={{ fontSize: '0.85rem', color: 'var(--event-text-sub)', marginTop: 6 }}>
            ⏰ <strong>{fmtDeadline(reg.payment_deadline_at)}</strong>까지 입금
          </div>
        )}
      </div>

      {reg.expected_depositor_name && (
        <div style={depositRow}>
          <span style={depositLabel}>입금자명 (꼭 이대로!)</span>
          <span style={depositValue}>{reg.expected_depositor_name}</span>
          <button onClick={() => copy(reg.expected_depositor_name, '입금자명')} style={smallBtn}>복사</button>
        </div>
      )}

      {(event.account_bank || event.account_number) && (
        <div style={depositRow}>
          <span style={depositLabel}>계좌</span>
          <span style={depositValue}>
            {event.account_bank} {event.account_number}
            {event.account_holder && <span style={{ color: 'var(--event-text-sub)', fontSize: '0.85rem', marginLeft: 6 }}>({event.account_holder})</span>}
          </span>
          <button onClick={() => copy(`${event.account_bank} ${event.account_number}`, '계좌')} style={smallBtn}>복사</button>
        </div>
      )}

      {(event.toss_send_url || event.kakaopay_send_url) && (
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {event.toss_send_url && (
            <a href={event.toss_send_url} target="_blank" rel="noopener noreferrer" style={{ ...payBtn, background: '#0064FF', color: '#fff' }}>
              토스로 송금
            </a>
          )}
          {event.kakaopay_send_url && (
            <a href={event.kakaopay_send_url} target="_blank" rel="noopener noreferrer" style={{ ...payBtn, background: '#FEE500', color: '#000' }}>
              카카오페이로 송금
            </a>
          )}
        </div>
      )}

      <p style={{ fontSize: '0.78rem', color: 'var(--event-text-sub)', margin: '14px 0 0', lineHeight: 1.5 }}>
        💡 정확한 <strong>입금자명</strong>으로 보내주셔야 자동 매칭됩니다. 다른 이름으로 입금했다면 운영자에게 알려주세요.
      </p>
    </section>
  );
}

const amountBox = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--event-card-border)',
  borderRadius: 10,
  padding: 16,
  textAlign: 'center',
  marginBottom: 14,
};
const depositRow = {
  display: 'grid',
  gridTemplateColumns: '110px 1fr auto',
  gap: 10,
  alignItems: 'center',
  padding: '10px 0',
  borderTop: '1px dashed var(--event-card-border)',
};
const depositLabel = { fontSize: '0.78rem', color: 'var(--event-text-sub)' };
const depositValue = { fontSize: '0.92rem', fontWeight: 600, wordBreak: 'break-all' };
const smallBtn = {
  padding: '4px 10px',
  background: 'transparent',
  border: '1px solid var(--event-card-border)',
  borderRadius: 6,
  color: 'var(--event-text)',
  fontSize: '0.78rem',
  cursor: 'pointer',
};
const payBtn = {
  flex: 1,
  padding: '14px',
  borderRadius: 10,
  textAlign: 'center',
  fontWeight: 700,
  fontSize: '0.95rem',
  textDecoration: 'none',
  display: 'block',
};
