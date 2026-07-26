-- RETURNS TABLE의 출력 변수와 CTE 컬럼이 같은 이름일 때 발생하는
-- PL/pgSQL ambiguous column reference를 제거한다.

CREATE OR REPLACE FUNCTION public.get_admin_analytics_rankings(
  p_start_date date,
  p_end_date date,
  p_user_id uuid DEFAULT NULL,
  p_game_id integer DEFAULT NULL,
  p_action_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(kind text, entity_id text, entity_name text, rent_count bigint, dibs_count bigint, return_count bigint, avg_duration_hours numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date OR p_end_date - p_start_date > 365 THEN RAISE EXCEPTION '조회 기간이 올바르지 않습니다.'; END IF;
  IF p_limit < 1 OR p_limit > 50 THEN RAISE EXCEPTION 'p_limit는 1~50 범위여야 합니다.'; END IF;

  RETURN QUERY
  WITH params AS (SELECT COALESCE(cardinality(p_action_types), 0) = 0 AS all_actions),
  rentals AS (
    SELECT r.* FROM public.rentals r
    WHERE (p_game_id IS NULL OR r.game_id = p_game_id)
      AND (p_user_id IS NULL OR r.user_id = p_user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = r.user_id AND ur.role_key = 'tester')
  ),
  borrower_rows(kind, entity_id, entity_name, rent_count, dibs_count, return_count, avg_duration_hours) AS (
    SELECT 'borrower'::text, COALESCE(r.user_id::text, 'external:' || COALESCE(NULLIF(r.renter_name, ''), 'unknown')), COALESCE(p.name, r.renter_name, '이름 없음'),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'RENT' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'DIBS' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'DIBS' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1 AND (params.all_actions OR 'RETURN' = ANY(p_action_types))),
      ROUND((AVG(EXTRACT(EPOCH FROM (r.returned_at - r.borrowed_at)) / 3600) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1))::numeric, 1)
    FROM rentals r CROSS JOIN params LEFT JOIN public.profiles p ON p.id = r.user_id
    GROUP BY r.user_id, p.name, r.renter_name
  ),
  game_rows(kind, entity_id, entity_name, rent_count, dibs_count, return_count, avg_duration_hours) AS (
    SELECT 'game'::text, r.game_id::text, COALESCE(g.name, r.game_name, '알 수 없는 게임'),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'RENT' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'DIBS' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'DIBS' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1 AND (params.all_actions OR 'RETURN' = ANY(p_action_types))),
      ROUND((AVG(EXTRACT(EPOCH FROM (r.returned_at - r.borrowed_at)) / 3600) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1))::numeric, 1)
    FROM rentals r CROSS JOIN params LEFT JOIN public.games g ON g.id = r.game_id
    GROUP BY r.game_id, g.name, r.game_name
  )
  SELECT * FROM (
    SELECT br.* FROM borrower_rows br
    ORDER BY (br.rent_count + br.dibs_count + br.return_count) DESC, br.entity_name
    LIMIT p_limit
  ) borrowers
  UNION ALL
  SELECT * FROM (
    SELECT gr.* FROM game_rows gr
    ORDER BY (gr.rent_count + gr.dibs_count + gr.return_count) DESC, gr.entity_name
    LIMIT p_limit
  ) games;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_analytics_rankings(date, date, uuid, integer, text[], integer) TO authenticated;
