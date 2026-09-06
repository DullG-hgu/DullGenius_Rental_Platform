-- 20260906_rental_due_date_kst.sql
--
-- 키오스크 대여 기한을 동아리 회칙에 맞춘다.
--
-- 회칙(src/constants.jsx:202, :310): "1박 2일을 원칙으로 하며, 빌린 다음날 저녁 12시까지 반납"
-- 기존 구현: due_date = now() + interval '2 days'
--   → 18:41 에 수령하면 기한이 "모레 18:41" 이 되어 회칙보다 최대 하루 가까이 관대했다.
--     연체 벌금 판정이 회칙과 어긋나 있었다.
--
-- ⚠️ DB 타임존은 UTC 다 (current_setting('TimeZone') = 'UTC').
--    그래서 date_trunc('day', now()) 를 그대로 쓰면 KST 자정이 아니라 UTC 자정(= KST 09:00)이 되어
--    9시간이 더 붙는다. 반드시 'Asia/Seoul' 로 변환한 뒤 절단해야 한다.
--
-- 이번 변경 범위는 키오스크 경로(kiosk_pickup, kiosk_rental)뿐이다.
-- rent_game / admin_rent_game 은 now() + interval '7 days' 로 회칙과 더 크게 어긋나 있으나,
-- 운영상 의도된 값일 수 있어 이번에는 건드리지 않는다. (별도 확인 필요)
--
-- 기존 대여 행(rentals)의 due_date 는 소급 변경하지 않는다. 앞으로 생성되는 건에만 적용된다.

-- ----------------------------------------------------------------
-- 헬퍼: 회칙상 반납 기한 (빌린 날의 다음날 밤 24시 = 다다음날 00:00 KST)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rental_due_date(p_from timestamptz DEFAULT now())
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- KST 벽시계로 날짜를 절단한 뒤 2일을 더해 다시 timestamptz 로 되돌린다.
  -- 예) 2026-09-06 18:41 KST 대여 → 2026-09-08 00:00 KST (= 9/7 밤 24시)
  SELECT (date_trunc('day', p_from AT TIME ZONE 'Asia/Seoul') + interval '2 days')
         AT TIME ZONE 'Asia/Seoul';
$function$;

COMMENT ON FUNCTION public.rental_due_date(timestamptz) IS
  '회칙상 반납 기한(1박 2일 = 빌린 다음날 밤 12시, KST 기준)을 계산한다.';

-- ----------------------------------------------------------------
-- kiosk_pickup: due_date 를 회칙 기준으로 교체
-- ----------------------------------------------------------------
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
    SET type = 'RENT', borrowed_at = now(), due_date = public.rental_due_date(), source = 'kiosk'
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
$function$
;

-- ----------------------------------------------------------------
-- kiosk_rental: due_date 를 회칙 기준으로 교체
-- ----------------------------------------------------------------
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
    VALUES (p_game_id, p_user_id, v_game_name, 'RENT', now(), public.rental_due_date(), 'kiosk');

    PERFORM public.recalc_game_availability(p_game_id);

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('action', 'Kiosk Rental'));

    RETURN jsonb_build_object('success', true);
END;
$function$
;

-- ----------------------------------------------------------------
-- 권한: 키오스크 RPC 는 anon 에게 열지 않는다 (CREATE OR REPLACE 는 기존 GRANT 를 보존하나 명시적으로 재확인)
-- ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.kiosk_pickup(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.kiosk_rental(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kiosk_pickup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_rental(integer, uuid) TO authenticated;

-- rental_due_date 는 순수 계산 함수(데이터 접근 없음)이므로 노출면이 없다. 기본 권한을 유지한다.
