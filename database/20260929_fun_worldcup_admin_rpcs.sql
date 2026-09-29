-- ================================================================
-- MIGRATION: fun_worldcup_admin_rpcs
-- 날짜: 2026-09-29
-- 배경: 이상형 월드컵 관리자 RPC + 중도 이탈 판 정리 크론 (spec_fun_worldcup.md §8·§9)
--
-- 전부 anon 실행 불가 (REVOKE ... FROM PUBLIC, anon). 본문의 is_admin() 이 관문.
-- fun_wc_abuse_check 는 메일 경고 발송기(서버)가 부를 수 있게 service_role 도 허용.
-- 중도 이탈 정리는 기존 cleanup_expired_dibs 를 건드리지 않고 별도 크론 잡으로 둔다.
-- ================================================================

-- 테마 전체 목록 (비활성 포함)
CREATE OR REPLACE FUNCTION public.fun_wc_admin_list_themes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', t.id, 'slug', t.slug, 'title', t.title, 'description', t.description,
             'filter', t.filter, 'allowed_sizes', to_jsonb(t.allowed_sizes),
             'is_active', t.is_active, 'sort_order', t.sort_order, 'updated_at', t.updated_at,
             'pool_count', (SELECT count(*) FROM public._fun_wc_pool(t.filter)),
             'play_count', (SELECT count(*) FROM public.fun_worldcup_runs r
                             WHERE r.theme_id = t.id AND r.status = 'finished')
           ) ORDER BY t.sort_order, t.created_at), '[]'::jsonb)
    FROM public.fun_worldcup_themes t
  );
END;
$$;

-- 필터 미리보기: 저장 전에 "현재 후보 N개"
CREATE OR REPLACE FUNCTION public.fun_wc_admin_preview_pool(p_filter jsonb)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  RETURN (SELECT count(*) FROM public._fun_wc_pool(COALESCE(p_filter, '{}'::jsonb)));
END;
$$;

-- 테마 추가(p_id NULL) / 수정
CREATE OR REPLACE FUNCTION public.fun_wc_admin_upsert_theme(
  p_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_filter jsonb,
  p_allowed_sizes integer[],
  p_is_active boolean,
  p_sort_order integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF NULLIF(btrim(p_title), '') IS NULL THEN RAISE EXCEPTION '제목을 입력해 주세요.'; END IF;
  IF p_filter IS NULL OR jsonb_typeof(p_filter) <> 'object' THEN RAISE EXCEPTION '필터 형식이 올바르지 않습니다.'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.fun_worldcup_themes (slug, title, description, filter, allowed_sizes, is_active, sort_order)
    VALUES (p_slug, btrim(p_title), NULLIF(btrim(p_description), ''), p_filter,
            COALESCE(p_allowed_sizes, '{8,16,32,64}'), COALESCE(p_is_active, true), COALESCE(p_sort_order, 0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.fun_worldcup_themes
    SET slug = p_slug,
        title = btrim(p_title),
        description = NULLIF(btrim(p_description), ''),
        filter = p_filter,
        allowed_sizes = COALESCE(p_allowed_sizes, allowed_sizes),
        is_active = COALESCE(p_is_active, is_active),
        sort_order = COALESCE(p_sort_order, sort_order),
        updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION '테마를 찾을 수 없습니다.'; END IF;
  END IF;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION '이미 쓰고 있는 주소(slug)입니다.';
  WHEN check_violation THEN RAISE EXCEPTION '주소(slug)나 강수 설정이 올바르지 않습니다.';
END;
$$;

-- 관리자 통계: 기간 내 판 수·완주율·위치 편향 (개발자 제외)
CREATE OR REPLACE FUNCTION public.fun_wc_admin_stats(
  p_slug text DEFAULT NULL,
  p_from timestamptz DEFAULT now() - interval '30 days',
  p_to timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN RAISE EXCEPTION '조회 기간이 올바르지 않습니다.'; END IF;

  RETURN (
    WITH r AS (
      SELECT r.*
      FROM public.fun_worldcup_runs r
      JOIN public.fun_worldcup_themes t ON t.id = r.theme_id
      WHERE (p_slug IS NULL OR t.slug = p_slug)
        AND r.started_at >= p_from AND r.started_at < p_to
        AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                        WHERE ur.user_id = r.user_id AND ur.role_key = 'tester')
    ),
    m AS (
      SELECT m.* FROM public.fun_worldcup_matches m JOIN r ON r.id = m.run_id
    )
    SELECT jsonb_build_object(
      'runs', jsonb_build_object(
        'member',    (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM r WHERE is_member GROUP BY status) x),
        'nonmember', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM r WHERE NOT is_member GROUP BY status) x)
      ),
      'distinct_members', (SELECT count(DISTINCT user_id) FROM r WHERE is_member),
      'distinct_devices', (SELECT count(DISTINCT anon_id) FROM r WHERE NOT is_member),
      'completion_by_size', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'size', size, 'started', n, 'finished', f,
                 'rate', round(f::numeric / NULLIF(n, 0), 4)) ORDER BY size), '[]'::jsonb)
        FROM (SELECT size, count(*) n, count(*) FILTER (WHERE status = 'finished') f FROM r GROUP BY size) x
      ),
      'matches', (SELECT count(*) FROM m),
      'top_pick_rate', (SELECT round(avg(picked_top::int)::numeric, 4) FROM m),
      'median_decide_ms', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY decide_ms) FROM m WHERE decide_ms IS NOT NULL)
    )
  );
END;
$$;

-- 이상 징후 점검: 한 기기가 판을 몰아서 돌렸거나, 전체 판 수가 직전 구간 대비 급증
-- 메일 경고 발송기(서버, service_role)도 호출할 수 있다.
CREATE OR REPLACE FUNCTION public.fun_wc_abuse_check(
  p_hours integer DEFAULT 24,
  p_device_threshold integer DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_window interval;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;
  IF p_hours IS NULL OR p_hours < 1 OR p_hours > 24 * 30 THEN RAISE EXCEPTION 'p_hours 범위가 올바르지 않습니다.'; END IF;
  v_window := make_interval(hours => p_hours);

  RETURN (
    WITH cur AS (
      SELECT * FROM public.fun_worldcup_runs WHERE started_at >= now() - v_window
    ),
    prev AS (
      SELECT count(*) n FROM public.fun_worldcup_runs
      WHERE started_at >= now() - 2 * v_window AND started_at < now() - v_window
    ),
    heavy AS (
      SELECT left(anon_id::text, 8) AS device, count(*) AS runs
      FROM cur WHERE NOT is_member
      GROUP BY anon_id HAVING count(*) >= p_device_threshold
    )
    SELECT jsonb_build_object(
      'window_hours', p_hours,
      'runs', (SELECT count(*) FROM cur),
      'nonmember_runs', (SELECT count(*) FROM cur WHERE NOT is_member),
      'prev_window_runs', (SELECT n FROM prev),
      'heavy_devices', (SELECT COALESCE(jsonb_agg(jsonb_build_object('device', device, 'runs', runs) ORDER BY runs DESC), '[]'::jsonb) FROM heavy),
      'alert', EXISTS (SELECT 1 FROM heavy)
               OR ((SELECT count(*) FROM cur) >= 200
                   AND (SELECT count(*) FROM cur) > 5 * GREATEST((SELECT n FROM prev), 1))
    )
  );
END;
$$;

-- 중도 이탈 판 정리: 6시간 넘게 started 인 판 → abandoned
CREATE OR REPLACE FUNCTION public.fun_wc_mark_abandoned()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.fun_worldcup_runs
  SET status = 'abandoned'
  WHERE status = 'started' AND started_at < now() - interval '6 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fun_wc_admin_list_themes() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_wc_admin_preview_pool(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_wc_admin_upsert_theme(uuid, text, text, text, jsonb, integer[], boolean, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_wc_admin_stats(text, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_wc_abuse_check(integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_wc_mark_abandoned() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fun_wc_admin_list_themes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_admin_preview_pool(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_admin_upsert_theme(uuid, text, text, text, jsonb, integer[], boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_admin_stats(text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_abuse_check(integer, integer) TO authenticated, service_role;

SELECT cron.schedule('fun-worldcup-abandon', '17 * * * *', 'select public.fun_wc_mark_abandoned();');
