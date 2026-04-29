// /event/team/:code — 팀 초대 코드로 합류
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getTeamByInviteCode, getEventBySlug, joinTeamByCode, getRegistration, getMyRegistration } from './api_events_public';
import { supabase } from '../lib/supabaseClient.jsx';
import EventPaymentGuide from './EventPaymentGuide';
import './EventPage.css';

export default function EventTeamJoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();
  const { showToast } = useToast();

  const [team, setTeam] = useState(null);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [extra, setExtra] = useState({});
  const [photoConsent, setPhotoConsent] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [doneReg, setDoneReg] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=/event/team/${code}`);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const t = await getTeamByInviteCode(code);
        if (!alive) return;
        if (!t) { setNotFound(true); return; }
        setTeam(t);
        // 행사 정보 — slug가 필요하므로 event_id로 직접 조회
        const { data: ev, error } = await supabase
          .from('events')
          .select(`
            id, slug, title, subtitle, status, bg_color, accent_color, hero_image_url,
            event_start_at, event_end_at, location, pricing,
            account_bank, account_number, account_holder, toss_send_url, kakaopay_send_url,
            extra_questions, require_privacy_consent, require_photo_consent,
            team_size_min, team_size_max
          `)
          .eq('id', t.event_id).maybeSingle();
        if (error) throw error;
        if (!alive) return;
        setEvent(ev);
        // 이미 신청한 사용자
        const myReg = await getMyRegistration(t.event_id, user.id);
        if (myReg) setDoneReg(myReg);
      } catch (e) {
        console.error(e);
        showToast('정보 로딩 실패: ' + e.message, { type: 'error' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [code, user, authLoading, navigate, showToast]);

  const questions = useMemo(() => Array.isArray(event?.extra_questions) ? event.extra_questions : [], [event]);

  if (authLoading || loading) {
    return <div className="event-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p>로딩 중…</p></div>;
  }
  if (notFound) {
    return (
      <div className="event-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <h2>유효하지 않은 초대 코드</h2>
        <Link to="/" style={{ color: '#888' }}>홈으로</Link>
      </div>
    );
  }

  const styleVars = {
    '--event-bg': event?.bg_color || '#1a1a2e',
    '--event-accent': event?.accent_color || '#667eea',
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (event?.require_privacy_consent && !privacyConsent) {
      return showToast('개인정보 수집·이용 동의가 필요합니다.', { type: 'error' });
    }
    for (const q of questions) {
      if (q.required) {
        const v = extra[q.key];
        if (q.type === 'checkbox' ? !v : (!v || (typeof v === 'string' && !v.trim()))) {
          return showToast(`"${q.label}"은(는) 필수 항목입니다.`, { type: 'error' });
        }
      }
    }
    setSubmitting(true);
    try {
      const regId = await joinTeamByCode(code, extra, photoConsent);
      const reg = await getRegistration(regId);
      showToast('팀 합류 완료! 입금 안내를 확인하세요.', { type: 'success' });
      setDoneReg(reg);
    } catch (e) {
      console.error(e);
      const m = e.message || '';
      if (m.includes('already_registered')) showToast('이미 신청한 행사입니다.', { type: 'error' });
      else if (m.includes('team_full')) showToast('팀이 이미 가득 찼습니다.', { type: 'error' });
      else if (m.includes('event_full')) showToast('정원이 마감되었습니다.', { type: 'error' });
      else if (m.includes('team_not_forming')) showToast('이미 마감된 팀입니다.', { type: 'error' });
      else if (m.includes('invalid_invite_code')) showToast('유효하지 않은 초대 코드입니다.', { type: 'error' });
      else showToast('합류 실패: ' + m, { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="event-page" style={styleVars}>
      <header className="event-apply-header">
        <Link to={event ? `/event/${event.slug}` : '/'} style={{ color: 'var(--event-text-sub)', textDecoration: 'none', fontSize: '0.9rem' }}>← {event?.title || '행사'}</Link>
        <h1 style={{ margin: '4px 0 0', fontSize: '1.4rem' }}>{doneReg ? '합류 완료' : '팀 합류'}</h1>
      </header>

      <div className="event-content" style={{ marginTop: 20 }}>
        <section className="event-section">
          <h2><span className="icon">🏷️</span> {team.team_name}</h2>
          <div style={{ color: 'var(--event-text-sub)', fontSize: '0.92rem' }}>
            {event?.title} · 목표 인원 {team.size_target}명
          </div>
        </section>

        {doneReg ? (
          <>
            <section className="event-section event-my-status">
              <h2><span className="icon">🎉</span> 합류 완료</h2>
              <p style={{ margin: 0 }}>
                {doneReg.status === 'pending' && '아래 안내대로 입금해주세요.'}
                {doneReg.status === 'paid' && '입금이 확인되었습니다.'}
                {doneReg.status === 'waitlisted' && '대기자로 등록되었습니다.'}
              </p>
            </section>
            {doneReg.status === 'pending' && doneReg.fee_amount > 0 && (
              <EventPaymentGuide event={event} reg={doneReg} />
            )}
            <Link to={`/event/${event.slug}`} className="event-apply-btn secondary" style={{ position: 'static', boxShadow: 'none', textAlign: 'center', textDecoration: 'none' }}>
              행사 페이지로
            </Link>
          </>
        ) : (
          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section className="event-section">
              <h2><span className="icon">👤</span> 신청자 정보</h2>
              <div style={readOnlyGrid}>
                <ReadOnly label="이름" value={profile?.display_name || profile?.name || user.email?.split('@')[0]} />
                {profile?.student_id && <ReadOnly label="학번" value={profile.student_id} />}
                {profile?.phone && <ReadOnly label="연락처" value={profile.phone} />}
              </div>
            </section>

            {questions.length > 0 && (
              <section className="event-section">
                <h2><span className="icon">📝</span> 추가 정보</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {questions.map((q) => <QuestionField key={q.key} q={q} value={extra[q.key]} onChange={(v) => setExtra((e) => ({ ...e, [q.key]: v }))} />)}
                </div>
              </section>
            )}

            <section className="event-section">
              <h2><span className="icon">✅</span> 동의</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {event?.require_privacy_consent && (
                  <label style={consentLabel}>
                    <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} />
                    <span>개인정보 수집·이용 동의 (필수)</span>
                  </label>
                )}
                {event?.require_photo_consent && (
                  <label style={consentLabel}>
                    <input type="checkbox" checked={photoConsent} onChange={(e) => setPhotoConsent(e.target.checked)} />
                    <span>사진 촬영·게시 동의 (선택)</span>
                  </label>
                )}
              </div>
            </section>

            <button type="submit" disabled={submitting} className="event-apply-btn" style={{ position: 'static', boxShadow: 'none' }}>
              {submitting ? '합류 중…' : '팀 합류하기'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ReadOnly({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--event-text-sub)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>{value || '-'}</span>
    </div>
  );
}

function QuestionField({ q, value, onChange }) {
  if (q.type === 'textarea') {
    return (
      <label style={fieldLabel}>
        <span>{q.label}{q.required && ' *'}</span>
        <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      </label>
    );
  }
  if (q.type === 'select') {
    return (
      <label style={fieldLabel}>
        <span>{q.label}{q.required && ' *'}</span>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          <option value="">— 선택 —</option>
          {(q.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  if (q.type === 'checkbox') {
    return (
      <label style={consentLabel}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span>{q.label}{q.required && ' *'}</span>
      </label>
    );
  }
  return (
    <label style={fieldLabel}>
      <span>{q.label}{q.required && ' *'}</span>
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </label>
  );
}

const inputStyle = { width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--event-card-border)', borderRadius: 8, color: 'var(--event-text)', fontSize: '0.95rem', boxSizing: 'border-box' };
const fieldLabel = { display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--event-text-sub)', fontSize: '0.85rem' };
const consentLabel = { display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.92rem', lineHeight: 1.5 };
const readOnlyGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 };
