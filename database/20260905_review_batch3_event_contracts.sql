-- ================================================================
-- 2026-09-05  RLS·RPC 검수 반영 3차 — 행사 기능 RLS 계약 정리 (첫 행사 오픈 전 선행)
-- 적용: mcp apply_migration (review_batch3_event_contracts)
-- ================================================================
--
-- 1) event_team_preview(p_invite_code)
--    초대 링크로 처음 오는 사람은 아직 팀원이 아니라 event_teams RLS(팀장·팀원만)에 걸려
--    팀을 못 보고 "유효하지 않은 초대 코드" 화면으로 갔다. 가입 전 미리보기에 필요한
--    최소 정보만 돌려주는 SECURITY DEFINER RPC. 로그인 필수, anon 실행 회수.
--    (초대 코드는 32문자 8자리 = 1.1조 경우의 수 → 열거 위험 없음)
-- 2) event_public_counts(p_event_id)
--    정원 진행률이 RLS 로 본인·팀장 신청만 센 부분 카운트를 전체처럼 보여주던 문제.
--    공개 행사(draft·archived·삭제 제외)에 한해 집계 숫자만 돌려준다. 개인정보 없음.
-- 3) event_registrations UNIQUE(event_id, user_id) → 활성 상태 한정 부분 유니크 인덱스
--    신청 RPC 5개는 전부 취소·환불 상태를 제외하고 중복을 검사하는데, 제약은 상태를 안 봐서
--    취소 후 재신청 INSERT 가 막혔다. 활성 행만 유일하면 된다.
--    프론트 getMyRegistration 도 활성 행만 보도록 같이 고친다 (단건 조회가 2행에 죽지 않게).
-- 4) event_refund — 결제 후 본인·관리자 취소(cancelled_self / cancelled_admin)도 환불 가능하게.
--    결제 여부는 status 대신 payment_received_at 으로 판정 (unmark_paid 가 이 값을 비운다).

-- ---------------------------------------------------------------- 1) 초대 미리보기
CREATE OR REPLACE FUNCTION public.event_team_preview(p_invite_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team  public.event_teams%ROWTYPE;
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT * INTO v_team FROM public.event_teams
    WHERE invite_code = upper(btrim(COALESCE(p_invite_code, '')));
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_count FROM public.event_registrations
    WHERE team_id = v_team.id
      AND status NOT IN ('cancelled_unpaid','cancelled_self','cancelled_admin','refunded');

  RETURN jsonb_build_object(
    'id',           v_team.id,
    'event_id',     v_team.event_id,
    'team_name',    v_team.team_name,
    'invite_code',  v_team.invite_code,
    'size_target',  v_team.size_target,
    'status',       v_team.status,
    'member_count', v_count
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.event_team_preview(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.event_team_preview(text) TO authenticated;

-- ---------------------------------------------------------------- 2) 공개 인원 집계
CREATE OR REPLACE FUNCTION public.event_public_counts(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event      public.events%ROWTYPE;
  v_paid       int := 0;
  v_pending    int := 0;
  v_waitlisted int := 0;
  v_teams      int := 0;
  v_total      int := 0;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND
     OR (NOT public.is_admin()
         AND (v_event.deleted_at IS NOT NULL OR v_event.status IN ('draft','archived'))) THEN
    RETURN jsonb_build_object('total', 0, 'paid', 0, 'pending', 0, 'waitlisted', 0);
  END IF;

  SELECT
    count(*) FILTER (WHERE status = 'paid'),
    count(*) FILTER (WHERE status = 'pending'),
    count(*) FILTER (WHERE status = 'waitlisted')
  INTO v_paid, v_pending, v_waitlisted
  FROM public.event_registrations
  WHERE event_id = p_event_id;

  -- 정원 단위가 팀이면 진행률 분자는 팀 수 (_event_is_full 과 같은 기준)
  IF v_event.capacity_unit = 'team' THEN
    SELECT count(*) INTO v_teams FROM public.event_teams
      WHERE event_id = p_event_id AND status != 'cancelled';
    v_total := v_teams;
  ELSE
    v_total := v_paid + v_pending;
  END IF;

  RETURN jsonb_build_object(
    'total', v_total, 'paid', v_paid, 'pending', v_pending, 'waitlisted', v_waitlisted
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.event_public_counts(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.event_public_counts(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------- 3) 활성 신청 한정 유일성
ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_event_id_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_active_user_key
  ON public.event_registrations (event_id, user_id)
  WHERE status NOT IN ('cancelled_unpaid','cancelled_self','cancelled_admin','refunded');

-- ---------------------------------------------------------------- 4) 환불 허용 상태 확장
CREATE OR REPLACE FUNCTION public.event_refund(p_registration_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_reg public.event_registrations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_reg FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_not_found'; END IF;
  IF v_reg.status = 'refunded' THEN RAISE EXCEPTION 'already_refunded'; END IF;
  -- 결제 사실은 상태가 아니라 결제 수령 시각으로 판정한다 (결제 → 취소 → 환불 흐름 연결)
  IF v_reg.payment_received_at IS NULL
     OR v_reg.status NOT IN ('paid','cancelled_self','cancelled_admin') THEN
    RAISE EXCEPTION 'not_paid_status';
  END IF;

  UPDATE public.event_registrations
    SET status = 'refunded',
        cancelled_at = COALESCE(cancelled_at, now()),
        cancel_reason = COALESCE(p_note, cancel_reason)
    WHERE id = p_registration_id;

  INSERT INTO public.event_payment_logs (registration_id, action, amount, note, performed_by)
  VALUES (p_registration_id, 'refund', v_reg.fee_amount, p_note, auth.uid());
END;
$function$;
