-- 2026-10-11 운영 적용 (마이그레이션 20261011_admin_extend_rentals_kst_midnight)
-- 2026-10-11 admin_extend_rentals: 연장 마감을 KST 자정으로 (안 A)
--
-- 관리자 UI 계약(DashboardTab 연장 프롬프트): 「입력한 일수의 자정 24시에 마감」, 기준일 = 오늘.
--   (기준일을 기존 due_date 로 바꾸는 안은 2026-09-05 철회됨 — 그대로 둔다)
-- 기존 식 date_trunc('day', now()) 는 DB 타임존(UTC) 기준이라 마감이 KST 08:59:59 가 됐다.
--   KST 00:00~08:59 에 연장하면 약속보다 15시간 이르게, 그 외에는 9시간 늦게 마감.
-- 수정: KST 날짜로 자른 뒤 N일 + 23:59:59 를 KST 로 해석.
-- p_days 가 NULL 로 오면 due_date 가 NULL 로 덮이던 구멍도 COALESCE(p_days, 7) 로 막는다
-- (로그는 이미 COALESCE(p_days, 7) 를 쓰고 있었다).
-- 시그니처·반환 형식·권한은 그대로. app_config 값은 건드리지 않는다.

CREATE OR REPLACE FUNCTION public.admin_extend_rentals(p_user_id uuid DEFAULT NULL::uuid, p_renter_name text DEFAULT NULL::text, p_game_id integer DEFAULT NULL::integer, p_rental_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_new_due_date TIMESTAMP WITH TIME ZONE;
    r RECORD;
    v_count INTEGER := 0;
BEGIN
    -- [안전장치 0] 관리자 확인
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '관리자 권한이 필요합니다.', 'count', 0);
    END IF;

    -- [안전장치 1] 타 렌탈 건 침해 방지: 조건이 모두 NULL이면 전체 업데이트 위험이 있으므로 즉시 차단
    IF p_user_id IS NULL AND p_renter_name IS NULL AND p_game_id IS NULL AND p_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '연장 대상을 특정할 수 없습니다. (모든 식별자가 비어있음)', 'count', 0);
    END IF;
    -- 오늘(KST) 기준으로 N일을 더한 날의 밤 12시(23:59:59 KST). DB 타임존이 UTC라 KST로 잘라야 한다
    v_new_due_date := (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul')
                       + (COALESCE(p_days, 7) || ' days')::interval
                       + interval '23 hours 59 minutes 59 seconds') AT TIME ZONE 'Asia/Seoul';
    FOR r IN
        SELECT rental_id, game_id, user_id, renter_name
        FROM public.rentals
        WHERE type = 'RENT'
          AND returned_at IS NULL
          AND (p_rental_id IS NULL OR rental_id = p_rental_id)
          AND (p_game_id IS NULL OR game_id = p_game_id)
          -- [안전장치 2] user_id와 renter_name 조건 최적화
          AND (
              (p_user_id IS NOT NULL AND user_id = p_user_id) OR
              (p_user_id IS NULL AND p_renter_name IS NOT NULL AND renter_name = p_renter_name) OR
              (p_user_id IS NULL AND p_renter_name IS NULL)
          )
    LOOP
        UPDATE public.rentals SET due_date = v_new_due_date WHERE rental_id = r.rental_id;

        INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (r.game_id, r.user_id, 'EXTEND', jsonb_build_object('message', COALESCE(p_days, 7) || '일 기한 연장', 'days', p_days, 'new_due_date', v_new_due_date, 'renter', COALESCE(r.renter_name, 'Unknown')));

        v_count := v_count + 1;
    END LOOP;

    IF v_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '조건에 맞는 연장할 활성 대여 건이 없습니다. 이미 반납되었거나 대상을 찾을 수 없습니다.', 'count', 0);
    END IF;

    RETURN jsonb_build_object('success', true, 'message', v_count || '건 연장 처리 완료', 'new_due_date', v_new_due_date, 'count', v_count);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_extend_rentals(uuid, text, integer, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_extend_rentals(uuid, text, integer, uuid, integer) TO authenticated;
