-- ============================================================
-- 키오스크 활성 예약/대여 목록 조회 RPC
--
-- 키오스크가 rentals -> profiles를 직접 조인하면 profiles RLS 때문에
-- 회원 정보가 null로 내려갈 수 있다. 필요한 최소 필드만 SECURITY DEFINER
-- RPC에서 반환하고, 키오스크/관리자 역할만 실행할 수 있게 한다.
-- 운영 DB에는 별도 승인 없이 적용하지 않는다.
-- ============================================================

CREATE OR REPLACE FUNCTION public.kiosk_list_active_reservations()
RETURNS TABLE (
    rental_id uuid,
    user_id uuid,
    game_id integer,
    borrowed_at timestamptz,
    due_date timestamptz,
    returned_at timestamptz,
    type text,
    renter_name text,
    profile_id uuid,
    profile_name text,
    profile_student_id text,
    game_name text,
    game_image text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT public.is_kiosk_or_admin() THEN
        RAISE EXCEPTION '키오스크 권한이 필요합니다.';
    END IF;

    RETURN QUERY
    SELECT
        r.rental_id,
        r.user_id,
        r.game_id,
        r.borrowed_at,
        r.due_date,
        r.returned_at,
        r.type,
        r.renter_name,
        p.id,
        p.name,
        p.student_id,
        g.name,
        g.image
    FROM public.rentals AS r
    LEFT JOIN public.profiles AS p ON p.id = r.user_id
    INNER JOIN public.games AS g ON g.id = r.game_id
    WHERE r.type = 'DIBS'
      AND r.returned_at IS NULL
      AND r.due_date > now()
    ORDER BY p.name NULLS LAST, r.due_date ASC, r.rental_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kiosk_list_active_rentals()
RETURNS TABLE (
    rental_id uuid,
    user_id uuid,
    game_id integer,
    borrowed_at timestamptz,
    due_date timestamptz,
    returned_at timestamptz,
    type text,
    renter_name text,
    profile_id uuid,
    profile_name text,
    profile_student_id text,
    game_name text,
    game_image text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT public.is_kiosk_or_admin() THEN
        RAISE EXCEPTION '키오스크 권한이 필요합니다.';
    END IF;

    RETURN QUERY
    SELECT
        r.rental_id,
        r.user_id,
        r.game_id,
        r.borrowed_at,
        r.due_date,
        r.returned_at,
        r.type,
        r.renter_name,
        p.id,
        p.name,
        p.student_id,
        g.name,
        g.image
    FROM public.rentals AS r
    LEFT JOIN public.profiles AS p ON p.id = r.user_id
    INNER JOIN public.games AS g ON g.id = r.game_id
    WHERE r.type = 'RENT'
      AND r.returned_at IS NULL
    ORDER BY p.name NULLS LAST, r.renter_name NULLS LAST, r.borrowed_at ASC, r.rental_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.kiosk_list_active_reservations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_list_active_reservations() FROM anon;
GRANT EXECUTE ON FUNCTION public.kiosk_list_active_reservations() TO authenticated;

REVOKE ALL ON FUNCTION public.kiosk_list_active_rentals() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_list_active_rentals() FROM anon;
GRANT EXECUTE ON FUNCTION public.kiosk_list_active_rentals() TO authenticated;
