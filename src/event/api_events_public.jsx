// 공개 행사 페이지용 API (RLS: status!='draft' OR is_admin())
import { supabase } from '../lib/supabaseClient.jsx';

const PUBLIC_COLUMNS = `
  id, slug, title, subtitle, status,
  hero_image_url, bg_color, accent_color,
  recruit_start_at, recruit_end_at, event_start_at, event_end_at, location,
  capacity, capacity_unit, waitlist_enabled,
  participation_mode, team_size_min, team_size_max,
  pricing,
  account_bank, account_number, account_holder, toss_send_url, kakaopay_send_url, payment_deadline_hours,
  description, schedule_items, faq_items, prize_text, refund_policy, extra_images,
  extra_questions,
  require_privacy_consent, require_photo_consent,
  allow_walk_in
`;

export async function getEventBySlug(slug) {
  const { data, error } = await supabase
    .from('events')
    .select(PUBLIC_COLUMNS)
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// 본인 이 행사 신청 내역 (있으면 1개)
export async function getMyRegistration(eventId, userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('event_registrations')
    .select('id, status, fee_amount, payment_deadline_at, expected_depositor_name, team_id, membership_tier')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// 모집 인원 현황 (정원 진행률용 — 활성 신청 카운트)
// RLS상 본인 외에는 SELECT 못 봄. 정확한 카운트는 SECURITY DEFINER RPC가 필요하므로
// v1에서는 운영자/본인만 보이는 부분 카운트로 사용. 정원 마감은 서버 RPC가 정확히 차단.
export async function getEventCounts(eventId) {
  try {
    const { data, error } = await supabase
      .from('event_registrations')
      .select('status')
      .eq('event_id', eventId);
    if (error) throw error;
    const rows = data || [];
    const paid = rows.filter((r) => r.status === 'paid').length;
    const pending = rows.filter((r) => r.status === 'pending').length;
    const waitlisted = rows.filter((r) => r.status === 'waitlisted').length;
    return { total: paid + pending, paid, pending, waitlisted };
  } catch {
    return { total: 0, paid: 0, pending: 0, waitlisted: 0 };
  }
}

// === RPC wrappers ===

export async function registerIndividual(eventId, extraAnswers, photoConsent) {
  const { data, error } = await supabase.rpc('event_register_individual', {
    p_event_id: eventId,
    p_extra_answers: extraAnswers || {},
    p_photo_consent: !!photoConsent,
  });
  if (error) throw error;
  return data; // registration_id (uuid)
}

export async function createTeam(eventId, teamName, sizeTarget, extraAnswers, photoConsent) {
  const { data, error } = await supabase.rpc('event_create_team', {
    p_event_id: eventId,
    p_team_name: teamName,
    p_size_target: sizeTarget,
    p_extra_answers: extraAnswers || {},
    p_photo_consent: !!photoConsent,
  });
  if (error) throw error;
  return data; // jsonb { team_id, registration_id, invite_code }
}

export async function joinTeamByCode(code, extraAnswers, photoConsent) {
  const { data, error } = await supabase.rpc('event_join_team', {
    p_invite_code: code,
    p_extra_answers: extraAnswers || {},
    p_photo_consent: !!photoConsent,
  });
  if (error) throw error;
  return data; // registration_id
}

export async function cancelMyRegistration(regId, reason) {
  const { error } = await supabase.rpc('event_cancel_my_registration', {
    p_registration_id: regId,
    p_reason: reason || null,
  });
  if (error) throw error;
}

// 등록 1건 (결제 안내용 — 본인 RLS로 SELECT 가능)
export async function getRegistration(regId) {
  const { data, error } = await supabase
    .from('event_registrations')
    .select(`
      id, event_id, team_id, status, fee_amount, is_invited,
      payment_deadline_at, payment_received_at,
      expected_depositor_name, actual_depositor_name,
      applicant_name, membership_tier
    `)
    .eq('id', regId)
    .single();
  if (error) throw error;
  return data;
}

// 팀 정보 (초대코드로)
export async function getTeamByInviteCode(code) {
  const { data, error } = await supabase
    .from('event_teams')
    .select('id, event_id, team_name, invite_code, leader_user_id, size_target, status')
    .eq('invite_code', code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// 내 행사 신청 목록 (MyPage용)
export async function listMyRegistrations(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('event_registrations')
    .select(`
      id, event_id, team_id, status, fee_amount,
      payment_deadline_at, expected_depositor_name,
      created_at, checked_in_at,
      events:event_id (
        id, slug, title, hero_image_url, accent_color,
        event_start_at, event_end_at, location, status
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
