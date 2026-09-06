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

// 취소·환불로 끝난 신청. 이 상태들은 재신청을 막지 않는다 (DB 부분 유니크 인덱스와 같은 목록)
const INACTIVE_REG_STATUSES = ['cancelled_unpaid', 'cancelled_self', 'cancelled_admin', 'refunded'];

// 본인 이 행사의 활성 신청 (있으면 1개)
// 취소 후 재신청하면 같은 행사에 행이 여러 개 남으므로 활성 행만 본다.
// 지난 신청 이력은 MyEventsCard(listMyRegistrations)가 보여준다.
export async function getMyRegistration(eventId, userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('event_registrations')
    .select('id, status, fee_amount, payment_deadline_at, expected_depositor_name, team_id, membership_tier')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .not('status', 'in', `(${INACTIVE_REG_STATUSES.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// 모집 인원 현황 (정원 진행률용)
// event_public_counts 는 SECURITY DEFINER 라 RLS 와 무관하게 전체 집계를 준다.
// 숫자만 내려오며(개인정보 없음), 정원 단위가 팀이면 total 은 팀 수다.
// 실패하면 0 으로 두되 그 경우 진행률 표시만 빠지고 정원 마감 판정은 서버 RPC 가 맡는다.
export async function getEventCounts(eventId) {
  try {
    const { data, error } = await supabase.rpc('event_public_counts', { p_event_id: eventId });
    if (error) throw error;
    return {
      total: data?.total ?? 0,
      paid: data?.paid ?? 0,
      pending: data?.pending ?? 0,
      waitlisted: data?.waitlisted ?? 0,
    };
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

// 팀 정보 (초대코드로) — 가입 전 미리보기
// event_teams 는 RLS 가 팀장·팀원에게만 열려 있어 처음 초대받은 사람은 직접 조회하면 null 이 됐다.
// event_team_preview 는 로그인한 사용자에게 코드가 맞을 때만 최소 정보를 돌려준다. 없으면 null.
export async function getTeamByInviteCode(code) {
  const { data, error } = await supabase.rpc('event_team_preview', { p_invite_code: code });
  if (error) throw error;
  return data || null;
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
