-- ================================================================
-- MIGRATION: review_followups
-- 날짜: 2026-09-02
-- 배경: anon_surface_hardening 독립 보안 리뷰 반영
--
-- 1) reset_semester_payments: 권한 검사 누락 → 로그인한 아무 회원이나 전 회원 회비 초기화 가능했음.
--    is_admin() 검사 추가.
-- 2) resolve_membership_tier: 임의 uuid의 회비 납부 여부 조회 가능. 내부(DEFINER 함수) 전용이므로
--    anon/authenticated EXECUTE 회수.
-- 3) send_user_log: 임의 action_type 삽입 가능 → 'LOST' 위조로 마이페이지 이력 조작,
--    'SEARCH' 대량 삽입으로 통계 오염. 클라이언트 로그 유형 화이트리스트 + 크기 제한.
-- 4) rentals 'Public view active rentals' 를 TO anon 으로 축소.
--    일반 회원이 테이블 직접 조회로 모든 활성 대여의 user_id/renter_name/note 를 읽을 수 있었음.
--    회원 화면은 마스킹 RPC(get_games_with_rentals)만 쓰고, 본인 행은 owner 정책으로 계속 읽힘.
--    관리자는 'Admin Manage Rentals', 키오스크는 kiosk_list_* RPC(DEFINER)라 영향 없음.
-- ================================================================

-- ---------------------------------------------------------------
-- 1) reset_semester_payments
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_semester_payments()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_reset_count INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '관리자 권한이 필요합니다.');
    END IF;

    UPDATE public.profiles SET is_paid = false
    WHERE id NOT IN (SELECT user_id FROM public.user_roles WHERE role_key IN ('admin', 'executive', 'payment_exempt'));

    GET DIAGNOSTICS v_reset_count = ROW_COUNT;

    INSERT INTO public.logs (user_id, action_type, details)
    VALUES (auth.uid(), 'SEMESTER_RESET', to_jsonb('학기 초기화: ' || v_reset_count || '명의 회비 상태 초기화'));

    RETURN jsonb_build_object('success', true, 'reset_count', v_reset_count, 'message', v_reset_count || '명의 회비 상태가 초기화되었습니다.');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reset_semester_payments() FROM anon;

-- ---------------------------------------------------------------
-- 2) resolve_membership_tier: 내부 전용
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.resolve_membership_tier(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_membership_tier(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_membership_tier(uuid) FROM authenticated;

-- ---------------------------------------------------------------
-- 3) send_user_log: 화이트리스트
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_user_log(p_game_id integer DEFAULT NULL::integer, p_action_type text DEFAULT 'ACTION'::text, p_details jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '로그인이 필요합니다.');
    END IF;

    -- 클라이언트가 기록할 수 있는 유형만 허용한다.
    -- RENT/RETURN/DIBS/LOST/SEMESTER_RESET 등 서버 전용 유형은 각 RPC 안에서만 기록된다.
    -- (get_my_rental_history 가 'LOST' 로그로 분실 여부를 판정하므로 위조를 막아야 한다)
    IF p_action_type IS NULL OR p_action_type NOT IN (
        'ACTION', 'VIEW', 'SEARCH', 'FILTER_CHANGE', 'MISS', 'STOCK_REQUEST',
        'OUT_OF_STOCK_VIEW', 'RESOURCE_CLICK', 'STATUS_CHANGE'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '허용되지 않은 로그 유형입니다.');
    END IF;

    IF p_details IS NOT NULL AND pg_column_size(p_details) > 4096 THEN
        RETURN jsonb_build_object('success', false, 'message', '로그 상세가 너무 큽니다.');
    END IF;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, auth.uid(), p_action_type, p_details);
    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$;

-- ---------------------------------------------------------------
-- 4) rentals 공개 정책을 anon 전용으로
-- ---------------------------------------------------------------
ALTER POLICY "Public view active rentals" ON public.rentals TO anon;
