-- get_admin_analytics_* RPC의 CTE 출력 이름을 명시한다.
-- PostgreSQL은 SELECT의 CASE/COUNT 식에 action_type/rent_count 등의 별칭을 자동으로 붙이지 않으므로,
-- 이후 CTE를 이름으로 참조할 때 "column does not exist" 오류가 발생할 수 있다.

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
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date OR p_end_date - p_start_date > 365 THEN
    RAISE EXCEPTION '조회 기간이 올바르지 않습니다.';
  END IF;
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
    SELECT 'borrower'::text,
      COALESCE(r.user_id::text, 'external:' || COALESCE(NULLIF(r.renter_name, ''), 'unknown')),
      COALESCE(p.name, r.renter_name, '이름 없음'),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'RENT' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'DIBS' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'DIBS' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1 AND (params.all_actions OR 'RETURN' = ANY(p_action_types))),
      ROUND((AVG(EXTRACT(EPOCH FROM (r.returned_at - r.borrowed_at)) / 3600) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1))::numeric, 1)
    FROM rentals r
    CROSS JOIN params
    LEFT JOIN public.profiles p ON p.id = r.user_id
    GROUP BY r.user_id, p.name, r.renter_name
  ),
  game_rows(kind, entity_id, entity_name, rent_count, dibs_count, return_count, avg_duration_hours) AS (
    SELECT 'game'::text,
      r.game_id::text,
      COALESCE(g.name, r.game_name, '알 수 없는 게임'),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'RENT' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'DIBS' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'DIBS' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1 AND (params.all_actions OR 'RETURN' = ANY(p_action_types))),
      ROUND((AVG(EXTRACT(EPOCH FROM (r.returned_at - r.borrowed_at)) / 3600) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1))::numeric, 1)
    FROM rentals r
    CROSS JOIN params
    LEFT JOIN public.games g ON g.id = r.game_id
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

CREATE OR REPLACE FUNCTION public.get_admin_analytics_activity(
  p_start_date date,
  p_end_date date,
  p_user_id uuid DEFAULT NULL,
  p_game_id integer DEFAULT NULL,
  p_action_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(occurred_at timestamptz, action_type text, user_id uuid, user_name text, game_id integer, game_name text, source text, details jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date OR p_end_date - p_start_date > 365 THEN
    RAISE EXCEPTION '조회 기간이 올바르지 않습니다.';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN RAISE EXCEPTION 'p_limit는 1~500 범위여야 합니다.'; END IF;

  RETURN QUERY
  WITH params AS (SELECT COALESCE(cardinality(p_action_types), 0) = 0 AS all_actions),
  activity(occurred_at, action_type, user_id, user_name, game_id, game_name, source, details) AS (
    SELECT r.borrowed_at,
      CASE WHEN r.type = 'DIBS' THEN 'DIBS' ELSE 'RENT' END,
      r.user_id,
      COALESCE(p.name, r.renter_name),
      r.game_id,
      COALESCE(g.name, r.game_name),
      r.source,
      jsonb_build_object('due_date', r.due_date, 'rental_id', r.rental_id)
    FROM public.rentals r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.games g ON g.id = r.game_id
    WHERE r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1
      AND (p_game_id IS NULL OR r.game_id = p_game_id) AND (p_user_id IS NULL OR r.user_id = p_user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = r.user_id AND ur.role_key = 'tester')
    UNION ALL
    SELECT r.returned_at,
      CASE WHEN r.type = 'DIBS' THEN 'DIBS_END' ELSE 'RETURN' END,
      r.user_id,
      COALESCE(p.name, r.renter_name),
      r.game_id,
      COALESCE(g.name, r.game_name),
      r.source,
      jsonb_build_object('rental_id', r.rental_id, 'overdue', r.type = 'RENT' AND r.returned_at > r.due_date)
    FROM public.rentals r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.games g ON g.id = r.game_id
    WHERE r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1
      AND (p_game_id IS NULL OR r.game_id = p_game_id) AND (p_user_id IS NULL OR r.user_id = p_user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = r.user_id AND ur.role_key = 'tester')
    UNION ALL
    SELECT l.created_at, l.action_type, l.user_id, p.name, l.game_id, g.name, 'log', l.details
    FROM public.logs l
    LEFT JOIN public.profiles p ON p.id = l.user_id
    LEFT JOIN public.games g ON g.id = l.game_id
    WHERE l.created_at >= p_start_date AND l.created_at < p_end_date + 1
      AND l.action_type NOT IN ('RENT', 'RETURN', 'DIBS', 'CANCEL_DIBS')
      AND (p_game_id IS NULL OR l.game_id = p_game_id) AND (p_user_id IS NULL OR l.user_id = p_user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = l.user_id AND ur.role_key = 'tester')
  )
  SELECT a.*
  FROM activity a
  CROSS JOIN params
  WHERE params.all_actions OR a.action_type = ANY(p_action_types)
  ORDER BY a.occurred_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_analytics_rankings(date, date, uuid, integer, text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_activity(date, date, uuid, integer, text[], integer) TO authenticated;
