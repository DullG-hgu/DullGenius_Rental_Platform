-- ================================================================
-- MIGRATION: harden_rental_rpcs_and_anon_grants
-- 날짜: 2026-09-02
-- 배경: 8/29 마이그레이션 독립 보안 리뷰 반영
--
-- 1) 권한 판별 함수를 anon도 실행 가능하게 한다.
--    auth.uid() 기준이라 anon에서는 항상 false를 돌려줄 뿐 노출이 없다.
--    anon이 실행 못 하면 TO public 정책이 하나라도 이 함수를 부르는 순간
--    비로그인 조회 전체가 permission denied로 죽는다 (2026-08 장애 원인).
--    ⚠️ 이 권한을 다시 회수하지 말 것.
-- 2) 관리자 전용 SECURITY DEFINER 함수의 anon EXECUTE 회수 (어드바이저 경고).
--    ingest_rental_request는 Google Apps Script가 anon 키 + 공유 시크릿으로
--    호출하는 설계이므로 제외한다.
-- 3) kiosk_pickup: 회비 검사 추가(간편 대여와 동일 기준), 만료 판정을
--    games 락 이후로 이동해 재고 초과 레이스 제거.
-- 4) kiosk_rental: 비회원(p_user_id NULL) 대여 명시적 거부.
-- ================================================================

-- ---------------------------------------------------------------
-- 1) 권한 판별 함수 anon 실행 허용
-- ---------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_kiosk_or_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_event_team_leader(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_event_team_member(uuid) TO anon;

-- ---------------------------------------------------------------
-- 2) 관리자 전용 함수 anon EXECUTE 회수
-- ---------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_update_user_roles(uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_activity FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_rankings FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_summary FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_timeline FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_game_purchase_requests FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_unavailable_game_views FROM anon;

-- ---------------------------------------------------------------
-- 3) kiosk_pickup
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kiosk_pickup(p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_game_id      INTEGER;
    v_user_id      UUID;
    v_type         TEXT;
    v_returned     TIMESTAMPTZ;
    v_due          TIMESTAMPTZ;
    v_quantity     INTEGER;
    v_is_rentable  BOOLEAN;
    v_expired      BOOLEAN;
    v_affected     INTEGER;
BEGIN
    IF NOT public.is_kiosk_or_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 필요합니다.');
    END IF;

    SELECT game_id, user_id, type, returned_at
    INTO v_game_id, v_user_id, v_type, v_returned
    FROM public.rentals WHERE rental_id = p_rental_id;

    IF v_game_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '예약 기록을 찾을 수 없습니다.');
    END IF;
    IF v_type != 'DIBS' THEN
        RETURN jsonb_build_object('success', false, 'message', '예약 상태가 아닙니다.');
    END IF;
    -- 이미 취소/정리된 예약을 되살리지 않는다
    IF v_returned IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 취소되었거나 만료 정리된 예약입니다.');
    END IF;

    -- 회비 검사: 간편 대여(kiosk_rental)와 동일 기준. 찜은 허용하되 수령에서 막는다.
    IF v_user_id IS NOT NULL
       AND is_payment_check_enabled() AND NOT is_user_payment_exempt(v_user_id) THEN
        IF NOT COALESCE((SELECT is_paid FROM public.profiles WHERE id = v_user_id), false) THEN
            RETURN jsonb_build_object('success', false, 'message', '회비 납부가 필요합니다.');
        END IF;
    END IF;

    SELECT quantity, is_rentable
    INTO v_quantity, v_is_rentable
    FROM public.games WHERE id = v_game_id FOR UPDATE;

    -- 예약 후 운영진이 대여 불가로 전환한 게임은 새 RENT로 전환하지 않는다.
    IF NOT COALESCE(v_is_rentable, true) THEN
        RETURN jsonb_build_object('success', false, 'message', '현재 대여할 수 없는 게임입니다. 운영진에게 문의해주세요.');
    END IF;

    -- [운영 방침] 같은 게임은 1인 1부 — 이미 대여 중이면 수령 거부 (찜은 정리)
    IF v_user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.rentals
        WHERE game_id = v_game_id AND user_id = v_user_id
          AND returned_at IS NULL AND type = 'RENT'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 이 게임을 대여 중입니다. 추가 대여는 운영진에게 문의해주세요.');
    END IF;

    -- 만료 판정은 games 락을 잡은 뒤에 한다.
    -- 락 대기 중 찜이 만료되면 count_active_occupancy가 이 찜을 점유로 세지 않으므로,
    -- 락 이전 값으로 판정하면 재고 검사를 건너뛰어 수량을 초과할 수 있다.
    SELECT due_date INTO v_due FROM public.rentals WHERE rental_id = p_rental_id;
    v_expired := (v_due IS NULL OR v_due <= now());

    -- 만료된 예약이어도 지금 재고가 남아 있으면 수령을 허용한다(사실상 일반 대여).
    IF v_expired AND COALESCE(v_quantity, 0) - public.count_active_occupancy(v_game_id) <= 0 THEN
        PERFORM public.recalc_game_availability(v_game_id);
        RETURN jsonb_build_object('success', false, 'message', '예약 시간이 지났고 남은 재고가 없습니다. 운영진에게 문의해주세요.');
    END IF;

    UPDATE public.rentals
    SET type = 'RENT', borrowed_at = now(), due_date = now() + interval '2 days', source = 'kiosk'
    WHERE rental_id = p_rental_id
      AND type = 'DIBS' AND returned_at IS NULL;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 처리된 예약입니다.');
    END IF;

    PERFORM public.recalc_game_availability(v_game_id);

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (v_game_id, v_user_id, 'RENT',
            jsonb_build_object('action', 'Kiosk Pickup', 'from_expired_dibs', v_expired));

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- ---------------------------------------------------------------
-- 4) kiosk_rental
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kiosk_rental(p_game_id integer, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_game_name   TEXT;
    v_quantity    INTEGER;
    v_is_rentable BOOLEAN;
BEGIN
    IF NOT public.is_kiosk_or_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 필요합니다.');
    END IF;

    -- 키오스크 대여는 반드시 회원 계정에 귀속한다.
    -- 비회원·수기 대여는 관리자 경로(admin_rent_game)로만 처리한다.
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '회원을 선택해주세요. 비회원 대여는 운영진에게 문의해주세요.');
    END IF;

    SELECT name, quantity, is_rentable
    INTO v_game_name, v_quantity, v_is_rentable
    FROM public.games WHERE id = p_game_id FOR UPDATE;

    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;

    IF NOT COALESCE(v_is_rentable, true) THEN
        RETURN jsonb_build_object('success', false, 'message', '현재 대여할 수 없는 게임입니다.');
    END IF;

    IF is_payment_check_enabled() AND NOT is_user_payment_exempt(p_user_id) THEN
        IF NOT COALESCE((SELECT is_paid FROM public.profiles WHERE id = p_user_id), false) THEN
            RETURN jsonb_build_object('success', false, 'message', '회비 납부가 필요합니다.');
        END IF;
    END IF;

    -- [운영 방침] 같은 게임은 1인 1부. 예외 대여는 관리자 경로(admin_rent_game)로만.
    IF EXISTS (
        SELECT 1 FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND returned_at IS NULL AND type = 'RENT'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 이 게임을 대여 중입니다. 다른 게임도 만나보세요!');
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND returned_at IS NULL AND type = 'DIBS' AND due_date > now()
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이 게임에 예약(찜)이 있습니다. 예약 수령으로 진행해주세요.');
    END IF;

    IF COALESCE(v_quantity, 0) - public.count_active_occupancy(p_game_id) <= 0 THEN
        PERFORM public.recalc_game_availability(p_game_id);
        RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
    END IF;

    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date, source)
    VALUES (p_game_id, p_user_id, v_game_name, 'RENT', now(), now() + interval '2 days', 'kiosk');

    PERFORM public.recalc_game_availability(p_game_id);

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('action', 'Kiosk Rental'));

    RETURN jsonb_build_object('success', true);
END;
$function$;
