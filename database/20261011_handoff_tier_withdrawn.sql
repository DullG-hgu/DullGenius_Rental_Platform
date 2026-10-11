-- 2026-10-11 머더 티어 집계에서 탈퇴 회원 제외 (예방 수정 — 우선순위 낮음)
--
-- 배경: 탈퇴 방식이 두 가지 섞여 있다.
--   1) withdraw_user()  → profiles 행 삭제. fun_tier_community 는 profiles JOIN 이라 이미 빠진다.
--   2) 예전 방식         → profiles.status = 'withdrawn' 만 남는다. 지금은 집계에 들어간다.
--   또 fun_tier_admin_stats 의 참여자 수는 placements 를 직접 세서 프로필이 지워진 탈퇴자도 센다.
-- 운영 조회(10/11, %1): withdrawn 프로필 2명 중 티어 참여 0행, 프로필 없는 티어 행 0, 참여자 3명.
--   → 지금 오염된 수치는 없다. 데이터는 지우지 않고 집계 조건만 맞춘다.
--
-- 변경점 (그 외 본문은 database/_LIVE/functions.sql 2026-10-10 스냅샷과 동일):
--   fun_tier_community   votes CTE 에 `AND pr.status IS DISTINCT FROM 'withdrawn'`
--   fun_tier_admin_stats participants 를 profiles JOIN + withdrawn 제외로
-- 시그니처·반환형·SECURITY DEFINER·search_path 유지. 권한은 _LIVE/grants.sql 82-83행 그대로 다시 명시.
--
-- ⚠️ 적용 전: _LIVE 와 운영 정의가 어긋난 이력이 있다(머더 티어 메모). 적용 직전에
--    SELECT pg_get_functiondef('public.fun_tier_community(text)'::regprocedure);
--    로 운영 본문을 확인하고, 위 두 변경점 외 차이가 있으면 이 파일을 운영 본문 기준으로 다시 맞춘다.
--
-- 되돌리기: 아래 두 함수를 _LIVE/functions.sql 의 이전 본문으로 CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.fun_tier_community(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_t   public.fun_tier_templates%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;

  RETURN (
    WITH pool AS (
      SELECT pool.id FROM public._fun_tier_pool(v_t.filter) pool
    ),
    votes AS (
      SELECT pl.user_id, pl.game_id, pl.tier,
             (CASE pl.tier WHEN 'S' THEN 5 WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 ELSE 1 END)::numeric AS score
      FROM public.fun_tier_placements pl
      JOIN pool ON pool.id = pl.game_id
      JOIN public.profiles pr ON pr.id = pl.user_id
      WHERE pl.template_id = v_t.id
        AND pr.status IS DISTINCT FROM 'withdrawn'  -- 예전 방식 탈퇴(프로필만 남음) 제외
        AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pl.user_id AND ur.role_key = 'tester')
    ),
    mu AS (SELECT COALESCE(avg(score), 3) AS m FROM votes),
    raters AS (
      SELECT v.user_id, count(*) AS n, (avg(v.score) - mu.m) * count(*) / (count(*) + 3.0) AS off
      FROM votes v CROSS JOIN mu GROUP BY v.user_id, mu.m
    ),
    per_game AS (
      SELECT v.game_id, count(*) AS n,
             count(*) FILTER (WHERE v.tier = 'S') AS s, count(*) FILTER (WHERE v.tier = 'A') AS a,
             count(*) FILTER (WHERE v.tier = 'B') AS b, count(*) FILTER (WHERE v.tier = 'C') AS c,
             count(*) FILTER (WHERE v.tier = 'D') AS d,
             avg(v.score) AS raw_avg, avg(v.score - r.off) AS adj_avg
      FROM votes v JOIN raters r ON r.user_id = v.user_id
      GROUP BY v.game_id
    ),
    items AS (
      SELECT g.id, g.name, g.image, g.min_players, g.max_players, g.playingtime,
             COALESCE(pg.n, 0) AS n, pg.s, pg.a, pg.b, pg.c, pg.d, pg.raw_avg, pg.adj_avg,
             CASE WHEN pg.adj_avg IS NULL THEN NULL
                  WHEN pg.adj_avg >= 4.5 THEN 'S' WHEN pg.adj_avg >= 3.5 THEN 'A'
                  WHEN pg.adj_avg >= 2.5 THEN 'B' WHEN pg.adj_avg >= 1.5 THEN 'C' ELSE 'D' END AS tier,
             COALESCE(pg.n, 0) >= v_t.min_sample
               AND (pg.s + pg.a)::numeric / pg.n >= 0.25
               AND (pg.c + pg.d)::numeric / pg.n >= 0.25 AS split
      FROM pool JOIN public.games g ON g.id = pool.id
      LEFT JOIN per_game pg ON pg.game_id = pool.id
    )
    SELECT jsonb_build_object(
      'slug', v_t.slug,
      'title', v_t.title,
      'min_sample', v_t.min_sample,
      'shrink_k', 3,
      'split_share', 0.25,
      'raters', (SELECT count(*) FROM raters),
      'global_mean', (SELECT round(m, 3) FROM mu),
      'my_offset', (SELECT round(off, 3) FROM raters WHERE user_id = v_uid),
      'my_count', (SELECT n FROM raters WHERE user_id = v_uid),
      'items', COALESCE(jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'image', i.image,
        'min_players', i.min_players, 'max_players', i.max_players, 'playingtime', i.playingtime,
        'n', i.n, 'tier', i.tier, 'split', COALESCE(i.split, false),
        'avg', round(i.adj_avg, 3), 'raw_avg', round(i.raw_avg, 3),
        'dist', jsonb_build_object('S', COALESCE(i.s, 0), 'A', COALESCE(i.a, 0), 'B', COALESCE(i.b, 0),
                                   'C', COALESCE(i.c, 0), 'D', COALESCE(i.d, 0))
      ) ORDER BY i.adj_avg DESC NULLS LAST, i.n DESC, i.name), '[]'::jsonb)
    )
    FROM items i
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fun_tier_admin_stats(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.fun_tier_templates%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;
  RETURN jsonb_build_object(
    'lists', (SELECT count(*) FROM public.fun_tier_lists WHERE template_id = v_t.id),
    -- 탈퇴(프로필 삭제·withdrawn) 회원의 남은 행은 참여자로 세지 않는다
    'participants', (SELECT count(DISTINCT pl.user_id)
                     FROM public.fun_tier_placements pl
                     JOIN public.profiles pr ON pr.id = pl.user_id
                     WHERE pl.template_id = v_t.id AND pr.status IS DISTINCT FROM 'withdrawn'),
    'public', (SELECT count(*) FROM public.fun_tier_lists WHERE template_id = v_t.id AND is_public),
    'community', CASE WHEN v_t.is_active THEN public.fun_tier_community(p_slug) END
  );
END;
$function$;

-- 권한: 기존과 동일 (_LIVE/grants.sql 82-83)
--   fun_tier_community   — 비회원도 티어표 결과를 본다 (anon·authenticated)
--   fun_tier_admin_stats — 관리자 전용 (authenticated, 함수 안에서 is_admin 확인)
REVOKE EXECUTE ON FUNCTION public.fun_tier_community(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fun_tier_community(text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.fun_tier_admin_stats(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fun_tier_admin_stats(text) TO authenticated;
