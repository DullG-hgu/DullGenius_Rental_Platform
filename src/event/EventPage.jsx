// /event/:slug — 공개 행사 페이지
// 디자인: bg_color/accent_color/hero_image_url로 행사별 차별화
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getEventBySlug, getMyRegistration, getEventCounts, getRegistration } from './api_events_public';
import EventPaymentGuide from './EventPaymentGuide';
import './EventPage.css';

const STATUS_LABEL = {
  draft: '비공개 (초안)',
  recruiting: '모집 중',
  closed: '모집 마감',
  ongoing: '진행 중',
  finished: '종료',
};

const fmtDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' });
};
const fmtPeriod = (start, end) => {
  if (!start) return '-';
  const s = fmtDate(start);
  if (!end) return s;
  return `${s} ~ ${fmtDate(end)}`;
};

const REG_STATUS_LABEL = {
  pending: '입금 대기',
  paid: '입금 확인됨 ✓',
  waitlisted: '대기자 등록',
  cancelled_unpaid: '미입금 만료',
  cancelled_self: '본인 취소',
  cancelled_admin: '운영자 취소',
  refunded: '환불 완료',
  no_show: '노쇼',
};

export default function EventPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [event, setEvent] = useState(null);
  const [myReg, setMyReg] = useState(null);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const ev = await getEventBySlug(slug);
        if (!alive) return;
        if (!ev) { setNotFound(true); return; }
        setEvent(ev);
        const tasks = [getEventCounts(ev.id)];
        if (user) tasks.push(getMyRegistration(ev.id, user.id));
        const [c, regSummary] = await Promise.all(tasks);
        if (!alive) return;
        setCounts(c);
        if (regSummary) {
          // 결제 안내까지 표시하려면 전체 정보 필요
          const full = await getRegistration(regSummary.id);
          if (alive) setMyReg(full);
        }
      } catch (e) {
        console.error(e);
        showToast('행사를 불러오지 못했습니다.', { type: 'error' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [slug, user?.id, showToast]);

  // 사용자 등급 추정 (UI용 — 실제 청구는 RPC에서 결정)
  const myTier = useMemo(() => {
    if (!user) return null;
    if (profile?.is_paid) return 'paid_member';
    return 'non_member';
  }, [user, profile]);

  if (loading) {
    return <div className="event-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p>로딩 중…</p></div>;
  }
  if (notFound) {
    return (
      <div className="event-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <h2>행사를 찾을 수 없습니다</h2>
        <Link to="/" style={{ color: '#888' }}>홈으로</Link>
      </div>
    );
  }

  const styleVars = {
    '--event-bg': event.bg_color || '#1a1a2e',
    '--event-accent': event.accent_color || '#667eea',
  };
  const heroStyle = event.hero_image_url
    ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.2), rgba(0,0,0,0.1)), url("${event.hero_image_url}")` }
    : { background: `linear-gradient(135deg, ${event.bg_color || '#1a1a2e'} 0%, ${event.accent_color || '#667eea'}55 100%)` };

  const pricing = event.pricing?.base || {};
  const isRecruiting = event.status === 'recruiting';
  const isFull = event.capacity != null && counts && counts.total >= event.capacity;

  return (
    <div className="event-page" style={styleVars}>
      {/* HERO */}
      <div className="event-hero" style={heroStyle}>
        <div className="event-hero-inner">
          <span className={`event-status-badge ${event.status}`}>{STATUS_LABEL[event.status] || event.status}</span>
          <h1>{event.title}</h1>
          {event.subtitle && <p className="subtitle">{event.subtitle}</p>}
        </div>
      </div>

      <div className="event-content">
        {/* 빠른 정보 */}
        <section className="event-section">
          <h2><span className="icon">📅</span> 행사 정보</h2>
          <div className="event-meta-grid">
            <div className="meta-item">
              <span className="meta-label">일시</span>
              <span className="meta-value">{fmtPeriod(event.event_start_at, event.event_end_at)}</span>
            </div>
            {event.location && (
              <div className="meta-item">
                <span className="meta-label">장소</span>
                <span className="meta-value">📍 {event.location}</span>
              </div>
            )}
            <div className="meta-item">
              <span className="meta-label">모집 기간</span>
              <span className="meta-value">{fmtPeriod(event.recruit_start_at, event.recruit_end_at)}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">정원</span>
              <span className="meta-value">
                {event.capacity == null ? '제한 없음' : `${event.capacity}${event.capacity_unit === 'team' ? '팀' : '명'}`}
                {event.waitlist_enabled && ' (대기 가능)'}
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">참가 방식</span>
              <span className="meta-value">
                {event.participation_mode === 'individual' && '개인 참가'}
                {event.participation_mode === 'team' && `팀 참가 (${event.team_size_min}~${event.team_size_max}명)`}
                {event.participation_mode === 'both' && `개인·팀 모두 가능`}
              </span>
            </div>
            {event.allow_walk_in === false && (
              <div className="meta-item">
                <span className="meta-label">현장 등록</span>
                <span className="meta-value">불가 (사전 신청 필수)</span>
              </div>
            )}
          </div>
          {event.capacity != null && counts && (
            <div className="event-capacity-bar">
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${Math.min(100, (counts.total / event.capacity) * 100)}%` }} />
              </div>
              <div className="bar-text">
                <span>신청 {counts.total} / {event.capacity}{event.capacity_unit === 'team' ? '팀' : '명'}</span>
                <span>{Math.round((counts.total / event.capacity) * 100)}%{counts.waitlisted > 0 ? ` · 대기 ${counts.waitlisted}` : ''}</span>
              </div>
            </div>
          )}
        </section>

        {/* 내 신청 상태 (있을 때) */}
        {myReg && (
          <section className="event-section event-my-status">
            <h2><span className="icon">✓</span> 내 신청</h2>
            <div className="status-line">
              <span className="label">상태</span>
              <span className="value">{REG_STATUS_LABEL[myReg.status] || myReg.status}</span>
            </div>
            <div className="status-line">
              <span className="label">참가비</span>
              <span className="value">{(myReg.fee_amount ?? 0).toLocaleString()}원</span>
            </div>
            {myReg.expected_depositor_name && myReg.status === 'pending' && (
              <div className="status-line">
                <span className="label">입금자명</span>
                <span className="value">{myReg.expected_depositor_name}</span>
              </div>
            )}
            {myReg.payment_deadline_at && myReg.status === 'pending' && (
              <div className="status-line">
                <span className="label">입금 마감</span>
                <span className="value">{fmtDate(myReg.payment_deadline_at)}</span>
              </div>
            )}
          </section>
        )}

        {/* 결제 안내 — 본인이 입금 대기 중이고 유료일 때 */}
        {myReg && myReg.status === 'pending' && myReg.fee_amount > 0 && (
          <EventPaymentGuide event={event} reg={myReg} />
        )}

        {/* 본문 */}
        {event.description && (
          <section className="event-section">
            <h2><span className="icon">📝</span> 소개</h2>
            <div className="event-description">{event.description}</div>
          </section>
        )}

        {/* 가격 */}
        {pricing && (pricing.paid_member || pricing.non_member || pricing.walk_in) && (
          <section className="event-section">
            <h2><span className="icon">💸</span> 참가비</h2>
            <div className="event-pricing-tiers">
              <PricingTier label="정회원" amount={pricing.paid_member} highlight={myTier === 'paid_member'} />
              <PricingTier label="비회원" amount={pricing.non_member} highlight={myTier === 'non_member'} />
              <PricingTier label="현장결제" amount={pricing.walk_in} disabled={event.allow_walk_in === false} />
            </div>
            <p className="event-pricing-cta">
              {!user && <>로그인하고 회원 가격으로 신청하세요. <Link to="/login">로그인</Link></>}
              {user && myTier === 'non_member' && pricing.paid_member < pricing.non_member && (
                <>회비 납부 시 <strong>{(pricing.non_member - pricing.paid_member).toLocaleString()}원</strong> 더 저렴해져요</>
              )}
              {user && myTier === 'paid_member' && <>정회원 할인 적용됨 ✓</>}
            </p>
          </section>
        )}

        {/* 일정 */}
        {Array.isArray(event.schedule_items) && event.schedule_items.length > 0 && (
          <section className="event-section">
            <h2><span className="icon">⏰</span> 진행 일정</h2>
            <div className="event-schedule-list">
              {event.schedule_items.map((row, i) => (
                <div key={i} className="event-schedule-row">
                  <span className="time">{row.time || '-'}</span>
                  <span className="content">{row.content}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 상금 */}
        {event.prize_text && (
          <section className="event-section">
            <h2><span className="icon">🏆</span> 상금·혜택</h2>
            <div className="event-description">{event.prize_text}</div>
          </section>
        )}

        {/* FAQ */}
        {Array.isArray(event.faq_items) && event.faq_items.length > 0 && (
          <section className="event-section">
            <h2><span className="icon">❓</span> 자주 묻는 질문</h2>
            <div className="event-faq-list">
              {event.faq_items.map((row, i) => (
                <details key={i} className="event-faq-item">
                  <summary>{row.q}</summary>
                  <div className="answer">{row.a}</div>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* 환불 정책 */}
        {event.refund_policy && (
          <section className="event-section">
            <h2><span className="icon">↩️</span> 환불 정책</h2>
            <div className="event-description" style={{ fontSize: '0.88rem', color: 'var(--event-text-sub)' }}>{event.refund_policy}</div>
          </section>
        )}

        {/* 추가 이미지 */}
        {Array.isArray(event.extra_images) && event.extra_images.length > 0 && (
          <section className="event-section">
            <h2><span className="icon">🖼️</span> 더 보기</h2>
            <div className="event-extra-images">
              {event.extra_images.map((url, i) => <img key={i} src={url} alt={`${event.title} ${i + 1}`} loading="lazy" />)}
            </div>
          </section>
        )}
      </div>

      {/* 신청 버튼 (sticky) */}
      <div className="event-apply-bar">
        <div className="inner">
          <ApplyButton
            event={event}
            isRecruiting={isRecruiting}
            isFull={isFull}
            myReg={myReg}
            user={user}
            onClick={() => {
              if (!user) { navigate(`/login?redirect=/event/${slug}/apply`); return; }
              if (myReg && myReg.status === 'pending') {
                document.querySelector('.event-section h2 .icon')?.closest('section')?.scrollIntoView({ behavior: 'smooth' });
                return;
              }
              if (myReg) { showToast('이미 신청한 행사입니다.', { type: 'info' }); return; }
              navigate(`/event/${slug}/apply`);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function PricingTier({ label, amount, highlight, disabled }) {
  const free = !amount || amount === 0;
  return (
    <div className={`event-pricing-tier ${highlight ? 'is-yours' : ''}`} style={disabled ? { opacity: 0.4 } : undefined}>
      <span className="tier-label">{label}{disabled ? ' (불가)' : ''}</span>
      <div className={`tier-amount ${free ? 'free' : ''}`}>
        {free ? '무료' : <>{amount.toLocaleString()}<span className="won">원</span></>}
      </div>
    </div>
  );
}

function ApplyButton({ event, isRecruiting, isFull, myReg, user, onClick }) {
  let label = '신청하기';
  let disabled = false;
  if (event.status === 'draft') { label = '준비 중 (관리자 미리보기)'; disabled = true; }
  else if (event.status === 'closed') { label = '모집 마감'; disabled = true; }
  else if (event.status === 'ongoing') { label = '행사 진행 중'; disabled = true; }
  else if (event.status === 'finished') { label = '행사 종료'; disabled = true; }
  else if (myReg) {
    if (myReg.status === 'paid') label = '신청 완료 ✓';
    else if (myReg.status === 'pending') label = '입금 대기 중 — 결제 안내 보기';
    else if (myReg.status === 'waitlisted') label = '대기자 등록됨';
    else label = '취소된 신청 (재신청 불가)';
    if (['cancelled_self', 'cancelled_admin', 'cancelled_unpaid', 'no_show', 'refunded'].includes(myReg.status)) disabled = true;
  } else if (isFull && !event.waitlist_enabled) { label = '정원 마감'; disabled = true; }
  else if (!user) { label = '로그인하고 신청하기'; }

  return (
    <button className="event-apply-btn" onClick={onClick} disabled={disabled}>{label}</button>
  );
}
