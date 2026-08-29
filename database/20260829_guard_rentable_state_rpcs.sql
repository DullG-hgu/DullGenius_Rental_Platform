-- ============================================================
-- 대여 가능 여부 서버 검증
--
-- UI가 아닌 대여 상태 변경 RPC에서 games.is_rentable을 검사한다.
-- 관리자 대여는 운영진 예외 경로로 유지하고, 반납은 대여 불가 게임도
-- 계속 허용해야 하므로 대상에서 제외한다.
-- 운영 DB에는 별도 승인 없이 적용하지 않는다.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dibs_game(p_game_id integer, p_user_id uuid)
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
    IF auth.uid() IS NULL OR (auth.uid() != p_user_id AND NOT public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    -- 같은 게임에 대한 동시 요청을 직렬화한다
    SELECT name, quantity, is_rentable
    INTO v_game_name, v_quantity, v_is_rentable
    FROM public.games WHERE id = p_game_id FOR UPDATE;

    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;

    -- NULL은 기존 UI의 동작과 호환되도록 기본값 true로 취급한다.
    IF NOT COALESCE(v_is_rentable, true) THEN
        RETURN jsonb_build_object('success', false, 'message', '현재 대여할 수 없는 게임입니다.');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND type = 'DIBS' AND returned_at IS NULL AND due_date > now()
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 찜한 게임입니다.');
    END IF;

    -- [운영 방침] 같은 게임은 1인 1부 — 대여 중이면 추가 찜 불가
    IF EXISTS (
        SELECT 1 FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND type = 'RENT' AND returned_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 대여 중인 게임입니다.');
    END IF;

    IF COALESCE(v_quantity, 0) - public.count_active_occupancy(p_game_id) <= 0 THEN
        PERFORM public.recalc_game_availability(p_game_id);
        RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
    END IF;

    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date, source)
    VALUES (p_game_id, p_user_id, v_game_name, 'DIBS', now(), now() + interval '30 minutes', 'app');

    PERFORM public.recalc_game_availability(p_game_id);

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'DIBS', jsonb_build_object('action', 'DIBS'));

    RETURN jsonb_build_object('success', true, 'message', '찜 완료');
END;
$function$;

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

    SELECT game_id, user_id, type, returned_at, due_date
    INTO v_game_id, v_user_id, v_type, v_returned, v_due
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
    -- (p_user_id가 NULL인 비회원 대여는 판정 불가라 통과)
    IF p_user_id IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION public.rent_game(p_game_id integer, p_user_id uuid, p_renter_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_game_name   TEXT;
    v_quantity    INTEGER;
    v_is_rentable BOOLEAN;
    v_affected    INTEGER;
BEGIN
    IF auth.uid() IS NULL OR (auth.uid() != p_user_id AND NOT public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
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

    -- [운영 방침] 같은 게임은 1인 1부 — 이미 대여 중이면 추가 대여 불가 (예외는 관리자 경로)
    IF EXISTS (
        SELECT 1 FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND type = 'RENT' AND returned_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 대여 중인 게임입니다.');
    END IF;

    -- 본인의 '유효한' 찜을 대여로 전환 — 이미 점유 중이므로 재고 재검사 불필요.
    -- returned_at IS NULL 필수: 닫힌 행을 되살리지 않는다.
    UPDATE public.rentals
    SET type = 'RENT',
        borrowed_at = now(),
        due_date = now() + interval '7 days',
        renter_name = p_renter_name,
        source = 'app'
    WHERE game_id = p_game_id AND user_id = p_user_id
      AND type = 'DIBS' AND returned_at IS NULL AND due_date > now();
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN
        -- 새 대여: 재고를 rentals 실측으로 판정한다 (캐시 컬럼 신뢰 금지)
        IF COALESCE(v_quantity, 0) - public.count_active_occupancy(p_game_id) <= 0 THEN
            PERFORM public.recalc_game_availability(p_game_id);
            RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
        END IF;

        -- 만료된 채 열려 있는 본인 찜은 정리하고 넘어간다
        UPDATE public.rentals SET returned_at = now()
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND type = 'DIBS' AND returned_at IS NULL;

        INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date, source)
        VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days', 'app');
    END IF;

    PERFORM public.recalc_game_availability(p_game_id);

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('action', 'RENT'));

    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$function$;
