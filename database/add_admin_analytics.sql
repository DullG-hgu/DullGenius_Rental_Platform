-- 관리자 고급 분석용 RPC
-- 적용 방법: Supabase SQL Editor에서 이 파일 전체를 실행합니다.
-- 모든 함수는 관리자(admin/executive)만 실행할 수 있으며 tester 계정의 활동은 제외합니다.

CREATE INDEX IF NOT EXISTS idx_rentals_analytics_borrowed
  ON public.rentals (borrowed_at, user_id, game_id, type);
CREATE INDEX IF NOT EXISTS idx_rentals_analytics_returned
  ON public.rentals (returned_at, user_id, game_id, type)
  WHERE returned_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_analytics_created
  ON public.logs (created_at, user_id, game_id, action_type);

-- 기간, 회원, 게임, 행동 종류를 공통으로 적용한 핵심 지표.
CREATE OR REPLACE FUNCTION public.get_admin_analytics_summary(
  p_start_date date,
  p_end_date date,
  p_user_id uuid DEFAULT NULL,
  p_game_id integer DEFAULT NULL,
  p_action_types text[] DEFAULT NULL
)
RETURNS TABLE(
  rent_count bigint,
  return_count bigint,
  dibs_count bigint,
  search_count bigint,
  view_count bigint,
  unique_borrower_count bigint,
  avg_duration_hours numeric,
  overdue_return_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION '올바른 조회 기간을 선택하세요.';
  END IF;
  IF p_end_date - p_start_date > 365 THEN
    RAISE EXCEPTION '조회 기간은 최대 366일입니다.';
  END IF;

  RETURN QUERY
  WITH params AS (
    SELECT COALESCE(cardinality(p_action_types), 0) = 0 AS all_actions
  ),
  scoped_rentals AS (
    SELECT r.*
    FROM public.rentals r
    WHERE (p_game_id IS NULL OR r.game_id = p_game_id)
      AND (p_user_id IS NULL OR r.user_id = p_user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = r.user_id AND ur.role_key = 'tester'
      )
  ),
  scoped_logs AS (
    SELECT l.*
    FROM public.logs l
    WHERE (p_game_id IS NULL OR l.game_id = p_game_id)
      AND (p_user_id IS NULL OR l.user_id = p_user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = l.user_id AND ur.role_key = 'tester'
      )
  )
  SELECT
    (SELECT COUNT(*) FROM scoped_rentals r, params
      WHERE r.type = 'RENT'
        AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1
        AND (params.all_actions OR 'RENT' = ANY(p_action_types))),
    (SELECT COUNT(*) FROM scoped_rentals r, params
      WHERE r.type = 'RENT' AND r.returned_at IS NOT NULL
        AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1
        AND (params.all_actions OR 'RETURN' = ANY(p_action_types))),
    (SELECT COUNT(*) FROM scoped_rentals r, params
      WHERE r.type = 'DIBS'
        AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1
        AND (params.all_actions OR 'DIBS' = ANY(p_action_types))),
    (SELECT COUNT(*) FROM scoped_logs l, params
      WHERE l.action_type = 'SEARCH'
        AND l.created_at >= p_start_date AND l.created_at < p_end_date + 1
        AND (params.all_actions OR 'SEARCH' = ANY(p_action_types))),
    (SELECT COUNT(*) FROM scoped_logs l, params
      WHERE l.action_type = 'VIEW'
        AND l.created_at >= p_start_date AND l.created_at < p_end_date + 1
        AND (params.all_actions OR 'VIEW' = ANY(p_action_types))),
    -- 비회원/수기 대여는 user_id 대신 renter_name으로 한 명으로 집계합니다.
    (SELECT COUNT(DISTINCT COALESCE(r.user_id::text, NULLIF(r.renter_name, ''))) FROM scoped_rentals r, params
      WHERE r.type = 'RENT'
        AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1
        AND (params.all_actions OR 'RENT' = ANY(p_action_types))),
    (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (r.returned_at - r.borrowed_at)) / 3600)::numeric, 1)
      FROM scoped_rentals r, params
      WHERE r.type = 'RENT' AND r.returned_at IS NOT NULL
        AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1
        AND (params.all_actions OR 'RETURN' = ANY(p_action_types))),
    (SELECT COUNT(*) FROM scoped_rentals r, params
      WHERE r.type = 'RENT' AND r.returned_at > r.due_date
        AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1
        AND (params.all_actions OR 'RETURN' = ANY(p_action_types)));
END;
$$;

-- 일별 행동 추이. 대여/반납/찜과 검색/조회 로그를 같은 축에서 비교합니다.
CREATE OR REPLACE FUNCTION public.get_admin_analytics_timeline(
  p_start_date date,
  p_end_date date,
  p_user_id uuid DEFAULT NULL,
  p_game_id integer DEFAULT NULL,
  p_action_types text[] DEFAULT NULL
)
RETURNS TABLE(date date, rent_count bigint, return_count bigint, dibs_count bigint, search_count bigint, view_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date OR p_end_date - p_start_date > 365 THEN
    RAISE EXCEPTION '조회 기간은 올바른 날짜 범위(최대 366일)여야 합니다.';
  END IF;

  RETURN QUERY
  WITH params AS (SELECT COALESCE(cardinality(p_action_types), 0) = 0 AS all_actions),
  days AS (SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date AS day),
  rentals AS (
    SELECT r.* FROM public.rentals r
    WHERE (p_game_id IS NULL OR r.game_id = p_game_id)
      AND (p_user_id IS NULL OR r.user_id = p_user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = r.user_id AND ur.role_key = 'tester')
  ),
  logs AS (
    SELECT l.* FROM public.logs l
    WHERE (p_game_id IS NULL OR l.game_id = p_game_id)
      AND (p_user_id IS NULL OR l.user_id = p_user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = l.user_id AND ur.role_key = 'tester')
  )
  -- rentals와 logs를 같은 날에 직접 조인하면 행 수가 서로 곱해지므로,
  -- 각 날짜별 집계를 LATERAL 서브쿼리로 분리합니다.
  SELECT d.day,
    rc.rent_count,
    rc.return_count,
    rc.dibs_count,
    lc.search_count,
    lc.view_count
  FROM days d
  CROSS JOIN params
  CROSS JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.borrowed_at >= d.day AND r.borrowed_at < d.day + 1
        AND (params.all_actions OR 'RENT' = ANY(p_action_types)))::bigint AS rent_count,
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= d.day AND r.returned_at < d.day + 1
        AND (params.all_actions OR 'RETURN' = ANY(p_action_types)))::bigint AS return_count,
      COUNT(*) FILTER (WHERE r.type = 'DIBS' AND r.borrowed_at >= d.day AND r.borrowed_at < d.day + 1
        AND (params.all_actions OR 'DIBS' = ANY(p_action_types)))::bigint AS dibs_count
    FROM rentals r
    WHERE (r.borrowed_at >= d.day AND r.borrowed_at < d.day + 1)
       OR (r.returned_at >= d.day AND r.returned_at < d.day + 1)
  ) rc
  CROSS JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE l.action_type = 'SEARCH' AND (params.all_actions OR 'SEARCH' = ANY(p_action_types)))::bigint AS search_count,
      COUNT(*) FILTER (WHERE l.action_type = 'VIEW' AND (params.all_actions OR 'VIEW' = ANY(p_action_types)))::bigint AS view_count
    FROM logs l
    WHERE l.created_at >= d.day AND l.created_at < d.day + 1
  ) lc
  ORDER BY d.day;
END;
$$;

-- 활동량 상위 대여자와 게임. RENT/DIBS 선택 여부를 반영합니다.
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
  borrower_rows AS (
    SELECT 'borrower'::text, COALESCE(r.user_id::text, 'external:' || COALESCE(NULLIF(r.renter_name, ''), 'unknown')), COALESCE(p.name, r.renter_name, '이름 없음'),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'RENT' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'DIBS' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'DIBS' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1 AND (params.all_actions OR 'RETURN' = ANY(p_action_types))),
      ROUND(AVG(EXTRACT(EPOCH FROM (r.returned_at - r.borrowed_at)) / 3600) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1)::numeric, 1)
    FROM rentals r
    CROSS JOIN params
    LEFT JOIN public.profiles p ON p.id = r.user_id
    GROUP BY r.user_id, p.name, r.renter_name
  ),
  game_rows AS (
    SELECT 'game'::text, r.game_id::text, COALESCE(g.name, r.game_name, '알 수 없는 게임'),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'RENT' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'DIBS' AND r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1 AND (params.all_actions OR 'DIBS' = ANY(p_action_types))),
      COUNT(*) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1 AND (params.all_actions OR 'RETURN' = ANY(p_action_types))),
      ROUND(AVG(EXTRACT(EPOCH FROM (r.returned_at - r.borrowed_at)) / 3600) FILTER (WHERE r.type = 'RENT' AND r.returned_at >= p_start_date AND r.returned_at < p_end_date + 1)::numeric, 1)
    FROM rentals r
    CROSS JOIN params
    LEFT JOIN public.games g ON g.id = r.game_id
    GROUP BY r.game_id, g.name, r.game_name
  )
  SELECT * FROM (
    SELECT * FROM borrower_rows ORDER BY (rent_count + dibs_count + return_count) DESC, entity_name LIMIT p_limit
  ) borrowers
  UNION ALL
  SELECT * FROM (
    SELECT * FROM game_rows ORDER BY (rent_count + dibs_count + return_count) DESC, entity_name LIMIT p_limit
  ) games;
END;
$$;

-- 최근 활동 원본: 대여 레코드와 검색/조회 등 일반 로그를 시간순으로 통합합니다.
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
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date OR p_end_date - p_start_date > 365 THEN RAISE EXCEPTION '조회 기간이 올바르지 않습니다.'; END IF;
  IF p_limit < 1 OR p_limit > 500 THEN RAISE EXCEPTION 'p_limit는 1~500 범위여야 합니다.'; END IF;

  RETURN QUERY
  WITH params AS (SELECT COALESCE(cardinality(p_action_types), 0) = 0 AS all_actions),
  activity AS (
    SELECT r.borrowed_at, CASE WHEN r.type = 'DIBS' THEN 'DIBS' ELSE 'RENT' END, r.user_id,
      COALESCE(p.name, r.renter_name), r.game_id, COALESCE(g.name, r.game_name), r.source,
      jsonb_build_object('due_date', r.due_date, 'rental_id', r.rental_id)
    FROM public.rentals r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.games g ON g.id = r.game_id
    WHERE r.borrowed_at >= p_start_date AND r.borrowed_at < p_end_date + 1
      AND (p_game_id IS NULL OR r.game_id = p_game_id) AND (p_user_id IS NULL OR r.user_id = p_user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = r.user_id AND ur.role_key = 'tester')
    UNION ALL
    SELECT r.returned_at, CASE WHEN r.type = 'DIBS' THEN 'DIBS_END' ELSE 'RETURN' END, r.user_id,
      COALESCE(p.name, r.renter_name), r.game_id, COALESCE(g.name, r.game_name), r.source,
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
      -- 대여 흐름 로그는 rentals에서 한 번만 보여 중복을 막습니다.
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

GRANT EXECUTE ON FUNCTION public.get_admin_analytics_summary(date, date, uuid, integer, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_timeline(date, date, uuid, integer, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_rankings(date, date, uuid, integer, text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_activity(date, date, uuid, integer, text[], integer) TO authenticated;
