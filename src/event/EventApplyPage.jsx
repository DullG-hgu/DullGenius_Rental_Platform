// /event/:slug/apply — 신청 페이지 (개인/팀 분기)
// 단계: 1. (참가방식이 both인 경우) 모드 선택 → 2. 폼 입력 → 3. 결제 안내
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getEventBySlug, getMyRegistration, registerIndividual, createTeam, getRegistration } from './api_events_public';
import EventPaymentGuide from './EventPaymentGuide';
import './EventPage.css';

export default function EventApplyPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();
  const { showToast } = useToast();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null); // 'individual' | 'team_leader'
  const [step, setStep] = useState('form'); // 'mode' | 'form' | 'done'
  const [doneReg, setDoneReg] = useState(null);
  const [doneTeam, setDoneTeam] = useState(null); // {team_id, invite_code}

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=/event/${slug}/apply`);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const ev = await getEventBySlug(slug);
        if (!alive) return;
        if (!ev) { showToast('행사를 찾을 수 없습니다.', { type: 'error' }); navigate('/'); return; }
        setEvent(ev);
        const myReg = await getMyRegistration(ev.id, user.id);
        if (myReg) {
          setDoneReg(myReg);
          setStep('done');
          setLoading(false);
          return;
        }
        // 모드 결정
        if (ev.participation_mode === 'individual') setMode('individual');
        else if (ev.participation_mode === 'team') setMode('team_leader');
        else setStep('mode'); // both → 사용자 선택
      } catch (e) {
        console.error(e);
        showToast('로딩 실패: ' + e.message, { type: 'error' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [slug, user, authLoading, navigate, showToast]);

  if (authLoading || loading) {
    return <div className="event-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p>로딩 중…</p></div>;
  }
  if (!event) return null;

  const styleVars = {
    '--event-bg': event.bg_color || '#1a1a2e',
    '--event-accent': event.accent_color || '#667eea',
  };

  return (
    <div className="event-page" style={styleVars}>
      <header className="event-apply-header">
        <Link to={`/event/${slug}`} style={{ color: 'var(--event-text-sub)', textDecoration: 'none', fontSize: '0.9rem' }}>← {event.title}</Link>
        <h1 style={{ margin: '4px 0 0', fontSize: '1.4rem' }}>{step === 'done' ? '신청 완료' : '신청하기'}</h1>
      </header>

      <div className="event-content" style={{ marginTop: 20 }}>
        {step === 'mode' && (
          <ModeSelect
            onPick={(m) => { setMode(m); setStep('form'); }}
            event={event}
          />
        )}

        {step === 'form' && mode && (
          <ApplyForm
            event={event}
            mode={mode}
            user={user}
            profile={profile}
            onSuccess={(reg, team) => { setDoneReg(reg); setDoneTeam(team || null); setStep('done'); }}
          />
        )}

        {step === 'done' && doneReg && (
          <DoneView event={event} reg={doneReg} team={doneTeam} slug={slug} />
        )}
      </div>
    </div>
  );
}

// === 모드 선택 (participation_mode === 'both') ===
function ModeSelect({ event, onPick }) {
  return (
    <section className="event-section">
      <h2><span className="icon">👥</span> 신청 방식 선택</h2>
      <p style={{ color: 'var(--event-text-sub)', margin: '0 0 16px', fontSize: '0.92rem' }}>
        이 행사는 개인·팀 모두 참가 가능합니다. 어떻게 참가하시겠어요?
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button onClick={() => onPick('individual')} style={modeBtn}>
          <strong>혼자 신청</strong>
          <span style={modeBtnSub}>주최자가 팀을 배정해주거나 개인 자격으로 참가합니다.</span>
        </button>
        <button onClick={() => onPick('team_leader')} style={modeBtn}>
          <strong>팀 만들기 (팀장)</strong>
          <span style={modeBtnSub}>{event.team_size_min}~{event.team_size_max}명 팀을 만들고 친구를 초대합니다.</span>
        </button>
      </div>
    </section>
  );
}

// === 신청 폼 ===
function ApplyForm({ event, mode, user, profile, onSuccess }) {
  const { showToast } = useToast();
  const [extra, setExtra] = useState({});
  const [photoConsent, setPhotoConsent] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [sizeTarget, setSizeTarget] = useState(event.team_size_min || 2);
  const [submitting, setSubmitting] = useState(false);

  const questions = useMemo(() => Array.isArray(event.extra_questions) ? event.extra_questions : [], [event.extra_questions]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (event.require_privacy_consent && !privacyConsent) {
      return showToast('개인정보 수집·이용 동의가 필요합니다.', { type: 'error' });
    }
    // 필수 질문 검증
    for (const q of questions) {
      if (q.required) {
        const v = extra[q.key];
        if (q.type === 'checkbox' ? !v : (!v || (typeof v === 'string' && !v.trim()))) {
          return showToast(`"${q.label}"은(는) 필수 항목입니다.`, { type: 'error' });
        }
      }
    }
    if (mode === 'team_leader') {
      if (!teamName.trim()) return showToast('팀명을 입력하세요.', { type: 'error' });
      const n = parseInt(sizeTarget, 10);
      if (!n || n < (event.team_size_min || 1) || n > (event.team_size_max || 99)) {
        return showToast(`팀 인원은 ${event.team_size_min}~${event.team_size_max}명이어야 합니다.`, { type: 'error' });
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'individual') {
        const regId = await registerIndividual(event.id, extra, photoConsent);
        const reg = await getRegistration(regId);
        showToast('신청 완료! 결제 안내를 확인하세요.', { type: 'success' });
        onSuccess(reg);
      } else {
        const result = await createTeam(event.id, teamName.trim(), parseInt(sizeTarget, 10), extra, photoConsent);
        const reg = await getRegistration(result.registration_id);
        showToast('팀 생성·신청 완료! 초대 코드를 친구들에게 공유하세요.', { type: 'success' });
        onSuccess(reg, { team_id: result.team_id, invite_code: result.invite_code });
      }
    } catch (e) {
      console.error(e);
      const m = e.message || '';
      if (m.includes('already_registered')) showToast('이미 신청한 행사입니다.', { type: 'error' });
      else if (m.includes('event_full')) showToast('정원이 마감되었습니다.', { type: 'error' });
      else if (m.includes('recruit_closed')) showToast('모집이 마감되었습니다.', { type: 'error' });
      else if (m.includes('event_not_recruiting')) showToast('현재 모집 중인 행사가 아닙니다.', { type: 'error' });
      else if (m.includes('team_name_taken')) showToast('이미 사용 중인 팀명입니다.', { type: 'error' });
      else if (m.includes('extra_answers_too_large')) showToast('추가 답변이 너무 깁니다.', { type: 'error' });
      else showToast('신청 실패: ' + m, { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 신청자 정보 (자동) */}
      <section className="event-section">
        <h2><span className="icon">👤</span> 신청자 정보</h2>
        <div style={readOnlyGrid}>
          <ReadOnly label="이름" value={profile?.display_name || profile?.name || user.email?.split('@')[0]} />
          {profile?.student_id && <ReadOnly label="학번" value={profile.student_id} />}
          {profile?.phone && <ReadOnly label="연락처" value={profile.phone} />}
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--event-text-sub)', margin: '12px 0 0' }}>
          마이페이지의 정보가 자동으로 사용됩니다. 잘못됐다면 마이페이지에서 수정 후 신청해주세요.
        </p>
      </section>

      {/* 팀장 모드: 팀 정보 */}
      {mode === 'team_leader' && (
        <section className="event-section">
          <h2><span className="icon">🏷️</span> 팀 정보</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={fieldLabel}>
              <span>팀명 *</span>
              <input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={30} style={inputStyle} placeholder="예: 컴공 1팀" />
            </label>
            <label style={fieldLabel}>
              <span>팀 인원 * ({event.team_size_min}~{event.team_size_max}명)</span>
              <input type="number" min={event.team_size_min || 1} max={event.team_size_max || 99} value={sizeTarget} onChange={(e) => setSizeTarget(e.target.value)} style={inputStyle} />
            </label>
            <p style={{ fontSize: '0.85rem', color: 'var(--event-text-sub)', margin: 0 }}>
              팀장이 먼저 신청한 뒤, 발급되는 <strong>초대 코드</strong>를 팀원에게 공유하세요.
            </p>
          </div>
        </section>
      )}

      {/* 추가 질문 */}
      {questions.length > 0 && (
        <section className="event-section">
          <h2><span className="icon">📝</span> 추가 정보</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {questions.map((q) => <QuestionField key={q.key} q={q} value={extra[q.key]} onChange={(v) => setExtra((e) => ({ ...e, [q.key]: v }))} />)}
          </div>
        </section>
      )}

      {/* 동의 */}
      <section className="event-section">
        <h2><span className="icon">✅</span> 동의</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {event.require_privacy_consent && (
            <label style={consentLabel}>
              <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} />
              <span>개인정보 수집·이용 동의 (필수) — 행사 운영 목적으로만 사용됩니다.</span>
            </label>
          )}
          {event.require_photo_consent && (
            <label style={consentLabel}>
              <input type="checkbox" checked={photoConsent} onChange={(e) => setPhotoConsent(e.target.checked)} />
              <span>사진 촬영·게시 동의 (선택)</span>
            </label>
          )}
        </div>
      </section>

      <button type="submit" disabled={submitting} className="event-apply-btn" style={{ position: 'static', boxShadow: 'none' }}>
        {submitting ? '신청 중…' : '신청하기'}
      </button>
    </form>
  );
}

// === 신청 완료 ===
function DoneView({ event, reg, team, slug }) {
  const inviteUrl = team?.invite_code ? `${window.location.origin}/event/team/${team.invite_code}` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section className="event-section event-my-status">
        <h2><span className="icon">🎉</span> 신청 완료</h2>
        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--event-text-sub)' }}>
          {reg.status === 'paid' && '입금이 확인되었습니다. 행사장에서 만나요!'}
          {reg.status === 'pending' && '아래 안내대로 입금해주세요. 운영자가 확인하면 신청이 확정됩니다.'}
          {reg.status === 'waitlisted' && '정원이 마감되어 대기자로 등록되었습니다. 자리가 나면 알려드릴게요.'}
        </p>
      </section>

      {team?.invite_code && (
        <section className="event-section">
          <h2><span className="icon">🔗</span> 팀 초대 코드</h2>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: 16, borderRadius: 10, textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.2em', fontFamily: 'monospace', color: 'var(--event-accent)' }}>{team.invite_code}</div>
          </div>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(team.invite_code); }} style={copyBtn}>코드 복사</button>
          {inviteUrl && (
            <button type="button" onClick={() => { navigator.clipboard?.writeText(inviteUrl); }} style={{ ...copyBtn, marginTop: 8 }}>합류 링크 복사</button>
          )}
          <p style={{ fontSize: '0.85rem', color: 'var(--event-text-sub)', margin: '12px 0 0' }}>
            팀원들에게 공유하세요. 각자 위 코드로 합류해서 본인 입금까지 마쳐야 신청이 완료됩니다.
          </p>
        </section>
      )}

      {reg.status === 'pending' && reg.fee_amount > 0 && (
        <EventPaymentGuide event={event} reg={reg} />
      )}

      <Link to={`/event/${slug}`} className="event-apply-btn secondary" style={{ position: 'static', boxShadow: 'none', textAlign: 'center', textDecoration: 'none' }}>
        행사 페이지로 돌아가기
      </Link>
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

function ReadOnly({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--event-text-sub)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>{value || '-'}</span>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  background: 'rgba(0,0,0,0.3)',
  border: '1px solid var(--event-card-border)',
  borderRadius: 8,
  color: 'var(--event-text)',
  fontSize: '0.95rem',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
const fieldLabel = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  color: 'var(--event-text-sub)',
  fontSize: '0.85rem',
};
const consentLabel = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  cursor: 'pointer',
  fontSize: '0.92rem',
  lineHeight: 1.5,
};
const readOnlyGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 12,
};
const modeBtn = {
  padding: '18px 16px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid var(--event-card-border)',
  borderRadius: 12,
  color: 'var(--event-text)',
  cursor: 'pointer',
  textAlign: 'left',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: '1rem',
};
const modeBtnSub = { fontSize: '0.85rem', color: 'var(--event-text-sub)', fontWeight: 400 };
const copyBtn = {
  width: '100%',
  padding: '12px',
  background: 'transparent',
  border: '1px solid var(--event-card-border)',
  borderRadius: 8,
  color: 'var(--event-text)',
  cursor: 'pointer',
  fontSize: '0.92rem',
  fontWeight: 600,
};
