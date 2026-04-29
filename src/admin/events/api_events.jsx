// src/admin/events/api_events.jsx
// 행사 관리 Supabase 호출 레이어 (Admin 전용)
import { supabase } from '../../lib/supabaseClient.jsx';

const EVENT_COLUMNS = `
  id, slug, title, subtitle, status,
  hero_image_url, bg_color, accent_color,
  recruit_start_at, recruit_end_at, event_start_at, event_end_at, location,
  capacity, capacity_unit, waitlist_enabled,
  participation_mode, team_size_min, team_size_max,
  pricing,
  account_bank, account_number, account_holder,
  toss_send_url, kakaopay_send_url, payment_deadline_hours,
  description, schedule_items, faq_items, prize_text, refund_policy, extra_images,
  extra_questions,
  require_privacy_consent, require_photo_consent,
  allow_walk_in,
  created_by, created_at, updated_at, deleted_at
`;

export async function listEvents({ includeDeleted = false } = {}) {
  let q = supabase.from('events').select(EVENT_COLUMNS).order('event_start_at', { ascending: false });
  if (!includeDeleted) q = q.is('deleted_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getEvent(id) {
  const { data, error } = await supabase.from('events').select(EVENT_COLUMNS).eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createEvent(payload) {
  const { data, error } = await supabase.from('events').insert(payload).select(EVENT_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function updateEvent(id, patch) {
  const { data, error } = await supabase.from('events').update(patch).eq('id', id).select(EVENT_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function softDeleteEvent(id) {
  const { error } = await supabase.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// 복제: 콘텐츠/디자인/가격은 복사, 슬러그·일정·신청자는 비움
export async function cloneEvent(id, { newSlug, newTitle }) {
  const src = await getEvent(id);
  const { id: _id, slug: _s, created_at, updated_at, deleted_at, created_by, ...copy } = src;
  const draft = {
    ...copy,
    slug: newSlug,
    title: newTitle ?? `${src.title} (복제)`,
    status: 'draft',
    recruit_start_at: src.recruit_start_at,
    recruit_end_at: src.recruit_end_at,
    event_start_at: src.event_start_at,
    event_end_at: src.event_end_at,
  };
  return createEvent(draft);
}

// === 신청자 명단 (admin) ===
export async function listRegistrations(eventId) {
  const { data, error } = await supabase
    .from('event_registrations')
    .select(`
      id, event_id, team_id, user_id,
      applicant_name, applicant_student_id, applicant_phone,
      membership_tier, fee_amount, is_invited, status,
      payment_deadline_at, payment_received_at,
      expected_depositor_name, actual_depositor_name,
      extra_answers, photo_consent, privacy_consent_at,
      checked_in_at, created_at, cancelled_at, cancel_reason,
      team:team_id ( id, team_name, invite_code )
    `)
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listEventTeams(eventId) {
  const { data, error } = await supabase
    .from('event_teams')
    .select('id, team_name, invite_code, leader_user_id, size_target, status')
    .eq('event_id', eventId)
    .order('team_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

// === Admin RPC wrappers ===

export async function markPaid(regId, actualDepositorName, note) {
  const { error } = await supabase.rpc('event_mark_paid', {
    p_registration_id: regId,
    p_actual_depositor_name: actualDepositorName || null,
    p_note: note || null,
  });
  if (error) throw error;
}

export async function unmarkPaid(regId, note) {
  const { error } = await supabase.rpc('event_unmark_paid', {
    p_registration_id: regId,
    p_note: note || null,
  });
  if (error) throw error;
}

export async function adminCheckIn(regId) {
  const { error } = await supabase.rpc('event_check_in', { p_registration_id: regId });
  if (error) throw error;
}

export async function adminCancel(regId, reason) {
  const { error } = await supabase.rpc('event_cancel_admin', {
    p_registration_id: regId,
    p_reason: reason || null,
  });
  if (error) throw error;
}

export async function adminRefund(regId, note) {
  const { error } = await supabase.rpc('event_refund', {
    p_registration_id: regId,
    p_note: note || null,
  });
  if (error) throw error;
}

export async function adminInviteUser(eventId, userId, note) {
  const { data, error } = await supabase.rpc('event_invite_user', {
    p_event_id: eventId,
    p_user_id: userId,
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

export async function adminRegister(eventId, userId, opts = {}) {
  const { data, error } = await supabase.rpc('event_admin_register', {
    p_event_id: eventId,
    p_user_id: userId,
    p_membership_tier: opts.membershipTier || null,
    p_team_id: opts.teamId || null,
    p_mark_paid: !!opts.markPaid,
    p_actual_depositor_name: opts.actualDepositorName || null,
    p_note: opts.note || null,
  });
  if (error) throw error;
  return data;
}

export async function expireUnpaid(eventId) {
  const { data, error } = await supabase.rpc('event_expire_unpaid', { p_event_id: eventId });
  if (error) throw error;
  return data; // 처리된 건 수
}

export async function promoteWaitlist(regId) {
  const { error } = await supabase.rpc('event_promote_waitlist', { p_registration_id: regId });
  if (error) throw error;
}

// === 회원 검색 (수동 등록·초대용) ===
export async function searchProfiles(q) {
  const term = (q || '').trim();
  if (term.length < 2) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, student_id, phone, is_paid')
    .or(`name.ilike.%${term}%,student_id.ilike.%${term}%`)
    .limit(20);
  if (error) throw error;
  return data || [];
}

// Storage 업로드 — event-images 버킷
export async function uploadEventImage(file, eventIdOrTmp = 'tmp') {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${eventIdOrTmp}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const { error } = await supabase.storage.from('event-images').upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('event-images').getPublicUrl(path);
  return publicUrl;
}
