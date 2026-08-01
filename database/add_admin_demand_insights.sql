-- 관리자 수요 분석: 재고 없음 상태 클릭과 게임 구매 요청을 기간/회원/게임 기준으로 조회합니다.

-- 상세 페이지 조회 시점의 재고 상태를 로그에 함께 저장한다.
-- 과거 VIEW 로그에는 상태 스냅샷이 없으므로 이후 생성되는 로그부터 정확한 집계가 가능합니다.
CREATE OR REPLACE FUNCTION public.increment_view_count(p_game_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_available_count integer;
  v_is_rentable boolean;
BEGIN
  SELECT
    GREATEST(0, COALESCE(g.quantity, 1) - COUNT(r.rental_id)::integer),
    COALESCE(g.is_rentable, true)
  INTO v_available_count, v_is_rentable
  FROM public.games g
  LEFT JOIN public.rentals r ON r.game_id = g.id
    AND r.returned_at IS NULL
    AND (
      r.type = 'RENT'
      OR (r.type = 'DIBS' AND r.due_date > now())
    )
  WHERE g.id = p_game_id
  GROUP BY g.quantity, g.is_rentable;

  IF NOT FOUND THEN RAISE EXCEPTION '게임을 찾을 수 없습니다.'; END IF;

  UPDATE public.games SET total_views = COALESCE(total_views, 0) + 1 WHERE id = p_game_id;

  INSERT INTO public.game_daily_stats (game_id, date, view_count)
  VALUES (p_game_id, current_date, 1)
  ON CONFLICT (game_id, date)
  DO UPDATE SET view_count = game_daily_stats.view_count + 1;

  INSERT INTO public.logs (game_id, user_id, action_type, details)
  VALUES (
    p_game_id,
    auth.uid(),
    'VIEW',
    jsonb_build_object(
      'value', 'Page view',
      'availability', CASE WHEN NOT v_is_rentable OR v_available_count = 0 THEN 'unavailable' ELSE 'available' END,
      'available_count', v_available_count,
      'is_rentable', v_is_rentable
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_unavailable_game_views(
  p_start_date date,
  p_end_date date,
  p_user_id uuid DEFAULT NULL,
  p_game_id integer DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(game_id integer, game_name text, unavailable_click_count bigint, last_clicked_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date OR p_end_date - p_start_date > 365 THEN
    RAISE EXCEPTION '조회 기간은 올바른 날짜 범위(최대 366일)여야 합니다.';
  END IF;
  IF p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'p_limit는 1~100 범위여야 합니다.'; END IF;

  RETURN QUERY
  SELECT l.game_id,
    COALESCE(g.name, '알 수 없는 게임'),
    COUNT(*)::bigint,
    MAX(l.created_at)
  FROM public.logs l
  LEFT JOIN public.games g ON g.id = l.game_id
  WHERE l.action_type = 'VIEW'
    AND l.details ->> 'availability' = 'unavailable'
    AND l.created_at >= p_start_date
    AND l.created_at < p_end_date + 1
    AND (p_user_id IS NULL OR l.user_id = p_user_id)
    AND (p_game_id IS NULL OR l.game_id = p_game_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = l.user_id AND ur.role_key = 'tester'
    )
  GROUP BY l.game_id, g.name
  ORDER BY unavailable_click_count DESC, last_clicked_at DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_game_purchase_requests(
  p_start_date date,
  p_end_date date,
  p_user_id uuid DEFAULT NULL,
  p_game_id integer DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(request_id uuid, created_at timestamptz, user_id uuid, user_name text, game_title text, description text, status text, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date OR p_end_date - p_start_date > 365 THEN
    RAISE EXCEPTION '조회 기간은 올바른 날짜 범위(최대 366일)여야 합니다.';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN RAISE EXCEPTION 'p_limit는 1~500 범위여야 합니다.'; END IF;

  RETURN QUERY
  SELECT q.id,
    q.created_at,
    q.user_id,
    COALESCE(p.name, '탈퇴 회원'),
    q.game_title,
    q.description,
    COALESCE(q.status, 'pending'),
    COUNT(*) OVER ()::bigint
  FROM public.game_requests q
  LEFT JOIN public.profiles p ON p.id = q.user_id
  WHERE q.created_at >= p_start_date
    AND q.created_at < p_end_date + 1
    AND (p_user_id IS NULL OR q.user_id = p_user_id)
    -- 게임 필터는 신청 제목과 현재 게임명이 정확히 일치하는 요청에만 적용합니다.
    AND (
      p_game_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.games g
        WHERE g.id = p_game_id AND lower(trim(g.name)) = lower(trim(q.game_title))
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = q.user_id AND ur.role_key = 'tester'
    )
  ORDER BY q.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_unavailable_game_views(date, date, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_game_purchase_requests(date, date, uuid, integer, integer) TO authenticated;
