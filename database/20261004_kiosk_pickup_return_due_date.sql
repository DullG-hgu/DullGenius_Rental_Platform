-- 2026-10-04 kiosk_pickup 이 반납 기한(due_date)을 함께 돌려준다.
-- 키오스크 결과 카드가 하드코딩 문구 대신 서버가 정한 기한을 보여주기 위함.
-- 반환 jsonb 에 키 하나 추가뿐. 권한·동작·GRANT 변화 없음 (CREATE OR REPLACE 는 기존 ACL 유지).

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
    v_new_due      TIMESTAMPTZ;
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
    SET type = 'RENT', borrowed_at = now(), due_date = public.rental_due_date(), source = 'kiosk'
    WHERE rental_id = p_rental_id
      AND type = 'DIBS' AND returned_at IS NULL
    RETURNING due_date INTO v_new_due;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 처리된 예약입니다.');
    END IF;

    PERFORM public.recalc_game_availability(v_game_id);

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (v_game_id, v_user_id, 'RENT',
            jsonb_build_object('action', 'Kiosk Pickup', 'from_expired_dibs', v_expired));

    -- 키오스크 결과 화면이 실제 반납 기한을 보여줄 수 있게 돌려준다 (2026-10-04)
    RETURN jsonb_build_object('success', true, 'due_date', v_new_due);
END;
$function$;
