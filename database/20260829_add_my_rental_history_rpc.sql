-- ============================================================
-- 개인 대여 이력 조회 RPC
--
-- RENT만 대상으로 하고, 분실 처리(LOST) 감사 로그가 있는 건은
-- 실제 반납과 구분해 반환한다. 개인 이력만 반환하므로 logs 전체를
-- 클라이언트에 노출하지 않는다.
-- 운영 DB에는 별도 승인 없이 적용하지 않는다.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_rentals_my_history
ON public.rentals (user_id, returned_at DESC, rental_id DESC)
WHERE type = 'RENT' AND returned_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logs_lost_rental_id
ON public.logs ((details->>'rental_id'))
WHERE action_type = 'LOST';

CREATE OR REPLACE FUNCTION public.get_my_rental_history()
RETURNS TABLE (
    rental_id uuid,
    game_id integer,
    game_name text,
    game_image text,
    borrowed_at timestamptz,
    returned_at timestamptz,
    type text,
    closure_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다.';
    END IF;

    RETURN QUERY
    SELECT
        r.rental_id,
        r.game_id,
        COALESCE(g.name, r.game_name, '알 수 없는 게임'),
        g.image,
        r.borrowed_at,
        r.returned_at,
        r.type,
        CASE WHEN EXISTS (
            SELECT 1
            FROM public.logs AS l
            WHERE l.action_type = 'LOST'
              AND l.details->>'rental_id' = r.rental_id::text
        ) THEN 'LOST' ELSE 'RETURNED' END
    FROM public.rentals AS r
    LEFT JOIN public.games AS g ON g.id = r.game_id
    WHERE r.user_id = auth.uid()
      AND r.type = 'RENT'
      AND r.returned_at IS NOT NULL
    ORDER BY r.returned_at DESC, r.rental_id DESC
    LIMIT 30;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_rental_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_rental_history() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_rental_history() TO authenticated;
