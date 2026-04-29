// 행사 정보 폼 (생성·수정 공용)
// Phase 3a — 모든 필드 입력 가능. 미리보기/검증은 최소화.
import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { createEvent, updateEvent, uploadEventImage } from './api_events';
import RepeatableRows from './components/RepeatableRows';
import ExtraQuestionsEditor from './components/ExtraQuestionsEditor';
import ColorField from './components/ColorField';

// DB events_slug_format CHECK과 동일 (최소 3자, 영숫자로 시작·종료)
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const STATUS_OPTIONS = [
  { v: 'draft', label: '초안 (비공개)' },
  { v: 'recruiting', label: '모집 중' },
  { v: 'closed', label: '모집 마감' },
  { v: 'ongoing', label: '진행 중' },
  { v: 'finished', label: '종료' },
];

const PARTICIPATION_OPTIONS = [
  { v: 'individual', label: '개인 참가' },
  { v: 'team', label: '팀 참가' },
  { v: 'both', label: '개인·팀 모두' },
];

// timestamptz ↔ datetime-local
const toLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (s) => (s ? new Date(s).toISOString() : null);

const EMPTY = {
  slug: '',
  title: '',
  subtitle: '',
  status: 'draft',
  hero_image_url: '',
  bg_color: '#1a1a2e',
  accent_color: '#667eea',
  recruit_start_at: '',
  recruit_end_at: '',
  event_start_at: '',
  event_end_at: '',
  location: '',
  capacity: '',
  capacity_unit: 'person',
  waitlist_enabled: true,
  participation_mode: 'individual',
  team_size_min: '',
  team_size_max: '',
  pricing: { base: { paid_member: 0, non_member: 0, walk_in: 0 } },
  account_bank: '',
  account_number: '',
  account_holder: '',
  toss_send_url: '',
  kakaopay_send_url: '',
  payment_deadline_hours: 48,
  description: '',
  schedule_items: [],
  faq_items: [],
  prize_text: '',
  refund_policy: '',
  extra_images: [],
  extra_questions: [],
  require_privacy_consent: true,
  require_photo_consent: false,
  allow_walk_in: true,
};

export default function EventInfoForm({ event, onSaved, onCancel }) {
  const { showToast } = useToast();
  const isEdit = !!event?.id;
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!event) { setForm(EMPTY); return; }
    setForm({
      ...EMPTY,
      ...event,
      recruit_start_at: toLocal(event.recruit_start_at),
      recruit_end_at: toLocal(event.recruit_end_at),
      event_start_at: toLocal(event.event_start_at),
      event_end_at: toLocal(event.event_end_at),
      capacity: event.capacity ?? '',
      team_size_min: event.team_size_min ?? '',
      team_size_max: event.team_size_max ?? '',
      pricing: event.pricing && Object.keys(event.pricing).length
        ? event.pricing
        : EMPTY.pricing,
      schedule_items: event.schedule_items || [],
      faq_items: event.faq_items || [],
      extra_images: event.extra_images || [],
      extra_questions: event.extra_questions || [],
    });
  }, [event]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setPricing = (tier, v) => {
    const n = v === '' ? 0 : parseInt(v, 10);
    setForm((f) => ({ ...f, pricing: { ...f.pricing, base: { ...(f.pricing?.base || {}), [tier]: Number.isFinite(n) ? n : 0 } } }));
  };

  const handleHeroUpload = useCallback(async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('파일이 10MB를 초과합니다.', { type: 'error' }); return; }
    setUploading(true);
    try {
      const url = await uploadEventImage(file, event?.id || 'tmp');
      set('hero_image_url', url);
      showToast('이미지 업로드 완료', { type: 'success' });
    } catch (e) {
      console.error(e);
      showToast('업로드 실패: ' + e.message, { type: 'error' });
    } finally {
      setUploading(false);
    }
  }, [event?.id, showToast]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // 검증
    if (!form.title.trim()) return showToast('행사명을 입력하세요.', { type: 'error' });
    if (!SLUG_REGEX.test(form.slug)) return showToast('슬러그는 3~64자, 영문 소문자/숫자/하이픈만 가능하고 양 끝은 영문/숫자여야 합니다.', { type: 'error' });
    if (!form.recruit_start_at || !form.recruit_end_at || !form.event_start_at) {
      return showToast('모집 일정과 행사 시작 일시는 필수입니다.', { type: 'error' });
    }

    const payload = {
      slug: form.slug.trim(),
      title: form.title.trim(),
      subtitle: form.subtitle?.trim() || null,
      status: form.status,
      hero_image_url: form.hero_image_url || null,
      bg_color: form.bg_color,
      accent_color: form.accent_color,
      recruit_start_at: fromLocal(form.recruit_start_at),
      recruit_end_at: fromLocal(form.recruit_end_at),
      event_start_at: fromLocal(form.event_start_at),
      event_end_at: fromLocal(form.event_end_at),
      location: form.location?.trim() || null,
      capacity: form.capacity === '' ? null : parseInt(form.capacity, 10),
      capacity_unit: form.capacity_unit,
      waitlist_enabled: !!form.waitlist_enabled,
      participation_mode: form.participation_mode,
      team_size_min: form.team_size_min === '' ? null : parseInt(form.team_size_min, 10),
      team_size_max: form.team_size_max === '' ? null : parseInt(form.team_size_max, 10),
      pricing: form.pricing,
      account_bank: form.account_bank?.trim() || null,
      account_number: form.account_number?.trim() || null,
      account_holder: form.account_holder?.trim() || null,
      toss_send_url: form.toss_send_url?.trim() || null,
      kakaopay_send_url: form.kakaopay_send_url?.trim() || null,
      payment_deadline_hours: parseInt(form.payment_deadline_hours, 10) || 48,
      description: form.description || null,
      schedule_items: form.schedule_items || [],
      faq_items: form.faq_items || [],
      prize_text: form.prize_text || null,
      refund_policy: form.refund_policy || null,
      extra_images: form.extra_images || [],
      extra_questions: form.extra_questions || [],
      require_privacy_consent: !!form.require_privacy_consent,
      require_photo_consent: !!form.require_photo_consent,
      allow_walk_in: !!form.allow_walk_in,
    };

    setSaving(true);
    try {
      const saved = isEdit ? await updateEvent(event.id, payload) : await createEvent(payload);
      showToast(isEdit ? '저장 완료' : '행사 생성 완료', { type: 'success' });
      onSaved?.(saved);
    } catch (e) {
      console.error(e);
      const msg = e.message || '';
      if (msg.includes('events_slug_unique') || msg.includes('duplicate key')) {
        showToast('이미 사용 중인 슬러그입니다.', { type: 'error' });
      } else {
        showToast('저장 실패: ' + msg, { type: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Section title="기본 정보">
        <Grid cols={2}>
          <Field label="행사명 *">
            <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="할리갈리 학부 대항전" style={input} />
          </Field>
          <Field label="슬러그 * (URL용, 영문 소문자/숫자/하이픈)">
            <input value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} placeholder="halligalli-2026" style={input} />
          </Field>
          <Field label="한 줄 소개">
            <input value={form.subtitle || ''} onChange={(e) => set('subtitle', e.target.value)} placeholder="학부 자존심을 건 한 판" style={input} />
          </Field>
          <Field label="상태">
            <select value={form.status} onChange={(e) => set('status', e.target.value)} style={input}>
              {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </Field>
        </Grid>
      </Section>

      <Section title="디자인">
        <Grid cols={3}>
          <ColorField label="배경색" value={form.bg_color} onChange={(v) => set('bg_color', v)} />
          <ColorField label="포인트 색 (버튼·강조)" value={form.accent_color} onChange={(v) => set('accent_color', v)} />
          <Field label="대표 이미지">
            <input type="file" accept="image/*" disabled={uploading} onChange={(e) => handleHeroUpload(e.target.files?.[0])} style={input} />
            {form.hero_image_url && (
              <div style={{ marginTop: 8 }}>
                <img src={form.hero_image_url} alt="hero" style={{ maxWidth: 200, maxHeight: 100, borderRadius: 4, border: '1px solid var(--admin-border)' }} />
                <button type="button" onClick={() => set('hero_image_url', '')} style={{ ...iconBtn, marginLeft: 8 }}>제거</button>
              </div>
            )}
          </Field>
        </Grid>
      </Section>

      <Section title="일정·장소">
        <Grid cols={2}>
          <Field label="모집 시작 *"><input type="datetime-local" value={form.recruit_start_at} onChange={(e) => set('recruit_start_at', e.target.value)} style={input} /></Field>
          <Field label="모집 종료 *"><input type="datetime-local" value={form.recruit_end_at} onChange={(e) => set('recruit_end_at', e.target.value)} style={input} /></Field>
          <Field label="행사 시작 *"><input type="datetime-local" value={form.event_start_at} onChange={(e) => set('event_start_at', e.target.value)} style={input} /></Field>
          <Field label="행사 종료"><input type="datetime-local" value={form.event_end_at} onChange={(e) => set('event_end_at', e.target.value)} style={input} /></Field>
          <Field label="장소" full><input value={form.location || ''} onChange={(e) => set('location', e.target.value)} placeholder="효암채플 1층" style={input} /></Field>
        </Grid>
      </Section>

      <Section title="정원·참가 방식">
        <Grid cols={3}>
          <Field label="정원 (비우면 무제한)">
            <input type="number" min="0" value={form.capacity} onChange={(e) => set('capacity', e.target.value)} style={input} />
          </Field>
          <Field label="정원 단위">
            <select value={form.capacity_unit} onChange={(e) => set('capacity_unit', e.target.value)} style={input}>
              <option value="person">인원</option>
              <option value="team">팀</option>
            </select>
          </Field>
          <Field label="대기자 허용">
            <label style={checkLabel}><input type="checkbox" checked={form.waitlist_enabled} onChange={(e) => set('waitlist_enabled', e.target.checked)} /> 정원 초과 시 대기자 등록 허용</label>
          </Field>
          <Field label="참가 방식">
            <select value={form.participation_mode} onChange={(e) => set('participation_mode', e.target.value)} style={input}>
              {PARTICIPATION_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </Field>
          {form.participation_mode !== 'individual' && (
            <>
              <Field label="팀 최소 인원"><input type="number" min="1" value={form.team_size_min} onChange={(e) => set('team_size_min', e.target.value)} style={input} /></Field>
              <Field label="팀 최대 인원"><input type="number" min="1" value={form.team_size_max} onChange={(e) => set('team_size_max', e.target.value)} style={input} /></Field>
            </>
          )}
        </Grid>
      </Section>

      <Section title="가격" hint="회원가입했지만 회비 미납인 사용자는 비회원 가격이 적용됩니다.">
        <Grid cols={3}>
          <Field label="정회원 참가비 (원)">
            <input type="number" min="0" value={form.pricing?.base?.paid_member ?? 0} onChange={(e) => setPricing('paid_member', e.target.value)} style={input} />
          </Field>
          <Field label="비회원 참가비 (원)">
            <input type="number" min="0" value={form.pricing?.base?.non_member ?? 0} onChange={(e) => setPricing('non_member', e.target.value)} style={input} />
          </Field>
          <Field label="현장결제 참가비 (원)">
            <input type="number" min="0" value={form.pricing?.base?.walk_in ?? 0} onChange={(e) => setPricing('walk_in', e.target.value)} style={input} />
          </Field>
          <Field label="현장결제(walk-in) 허용" full>
            <label style={checkLabel}>
              <input type="checkbox" checked={form.allow_walk_in} onChange={(e) => set('allow_walk_in', e.target.checked)} />
              현장 등록 허용 — 인원 칼같이 지킬 행사면 끄세요
            </label>
          </Field>
        </Grid>
      </Section>

      <Section title="결제 안내">
        <Grid cols={2}>
          <Field label="은행"><input value={form.account_bank || ''} onChange={(e) => set('account_bank', e.target.value)} placeholder="토스뱅크" style={input} /></Field>
          <Field label="계좌번호"><input value={form.account_number || ''} onChange={(e) => set('account_number', e.target.value)} placeholder="1000-1234-5678" style={input} /></Field>
          <Field label="예금주"><input value={form.account_holder || ''} onChange={(e) => set('account_holder', e.target.value)} placeholder="홍길동(덜지니어스)" style={input} /></Field>
          <Field label="입금 마감 (시간)"><input type="number" min="1" max="720" value={form.payment_deadline_hours} onChange={(e) => set('payment_deadline_hours', e.target.value)} style={input} /></Field>
          <Field label="토스 송금 링크"><input value={form.toss_send_url || ''} onChange={(e) => set('toss_send_url', e.target.value)} placeholder="supertoss://send?..." style={input} /></Field>
          <Field label="카카오페이 송금 링크"><input value={form.kakaopay_send_url || ''} onChange={(e) => set('kakaopay_send_url', e.target.value)} placeholder="https://qr.kakaopay.com/..." style={input} /></Field>
        </Grid>
      </Section>

      <Section title="콘텐츠">
        <Field label="본문 (행사 소개)" full>
          <textarea value={form.description || ''} onChange={(e) => set('description', e.target.value)} rows={6} style={{ ...input, resize: 'vertical' }} />
        </Field>
        <Field label="일정 (시간 + 내용)" full>
          <RepeatableRows
            value={form.schedule_items}
            onChange={(v) => set('schedule_items', v)}
            fields={[
              { key: 'time', label: '시간', placeholder: '14:00', flex: 0, minWidth: 120 },
              { key: 'content', label: '내용', placeholder: '개회식', flex: 3 },
            ]}
            addLabel="+ 일정 행 추가"
          />
        </Field>
        <Field label="FAQ (질문 + 답변)" full>
          <RepeatableRows
            value={form.faq_items}
            onChange={(v) => set('faq_items', v)}
            fields={[
              { key: 'q', label: '질문', placeholder: '회비를 안 냈는데 참가 가능한가요?', flex: 2 },
              { key: 'a', label: '답변', type: 'textarea', placeholder: '비회원으로 참가 가능합니다.', flex: 3 },
            ]}
            addLabel="+ FAQ 행 추가"
          />
        </Field>
        <Grid cols={2}>
          <Field label="상금 안내"><textarea value={form.prize_text || ''} onChange={(e) => set('prize_text', e.target.value)} rows={3} style={{ ...input, resize: 'vertical' }} /></Field>
          <Field label="환불 정책"><textarea value={form.refund_policy || ''} onChange={(e) => set('refund_policy', e.target.value)} rows={3} style={{ ...input, resize: 'vertical' }} /></Field>
        </Grid>
      </Section>

      <Section title="신청 폼 추가 질문">
        <ExtraQuestionsEditor value={form.extra_questions} onChange={(v) => set('extra_questions', v)} />
      </Section>

      <Section title="동의 항목">
        <label style={checkLabel}>
          <input type="checkbox" checked={form.require_privacy_consent} onChange={(e) => set('require_privacy_consent', e.target.checked)} />
          개인정보 수집·이용 동의 (필수, 끄지 마세요)
        </label>
        <label style={checkLabel}>
          <input type="checkbox" checked={form.require_photo_consent} onChange={(e) => set('require_photo_consent', e.target.checked)} />
          사진 게시 동의 받기 (선택)
        </label>
      </Section>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', borderTop: '1px solid var(--admin-border)', paddingTop: 20 }}>
        {onCancel && <button type="button" onClick={onCancel} style={btnSecondary}>취소</button>}
        <button type="submit" disabled={saving || uploading} style={btnPrimary}>
          {saving ? '저장 중…' : isEdit ? '저장' : '행사 생성'}
        </button>
      </div>
    </form>
  );
}

// --- 헬퍼 컴포넌트 ---

const Section = ({ title, hint, children }) => (
  <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 20 }}>
    <h3 style={{ margin: '0 0 4px', color: 'var(--admin-text-main)', fontSize: '1rem' }}>{title}</h3>
    {hint && <p style={{ margin: '0 0 16px', color: 'var(--admin-text-sub)', fontSize: '0.8rem' }}>{hint}</p>}
    {!hint && <div style={{ height: 12 }} />}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
  </div>
);

const Grid = ({ cols = 2, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 14 }}>{children}</div>
);

const Field = ({ label, children, full }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: full ? `1 / -1` : undefined }}>
    <span style={{ fontSize: '0.85rem', color: 'var(--admin-text-sub)' }}>{label}</span>
    {children}
  </label>
);

const input = {
  padding: '8px 10px',
  background: 'var(--admin-bg)',
  color: 'var(--admin-text-main)',
  border: '1px solid var(--admin-border)',
  borderRadius: 4,
  fontSize: '0.9rem',
  width: '100%',
  boxSizing: 'border-box',
};
const checkLabel = { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-text-main)', fontSize: '0.9rem' };
const iconBtn = { padding: '4px 10px', background: 'transparent', color: 'var(--admin-text-sub)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' };
const btnPrimary = { padding: '10px 20px', background: 'var(--admin-primary)', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 };
const btnSecondary = { padding: '10px 20px', background: 'transparent', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer' };
