-- ================================================================
-- MIGRATION: fun_worldcup_public_rpcs
-- 날짜: 2026-09-29
-- 배경: 이상형 월드컵 공개 RPC (spec_fun_worldcup.md §8)
--
-- anon 실행 허용 (의도된 새 노출 면 — _LIVE/grants.sql 에서 이 5개만 anon=Y 여야 함):
--   fun_wc_list_themes / fun_wc_start / fun_wc_finish / fun_wc_get_run / fun_wc_ranking
-- 쓰기 대상은 fun_worldcup_runs / fun_worldcup_matches 뿐. 기존 테이블은 읽기만 한다.
--
-- 도배 방지: 기기(anon_id) 또는 회원(user_id)당 1시간 20판. IP 제한은 두지 않음
--            (같은 학교 네트워크라 의미 없음 — 2026-09-29 결정). 이상 징후는 관리자 경고로.
-- ================================================================

-- ── 내부 헬퍼 (외부 실행 불가) ─────────────────────────────────────

-- 테마 필터 → 후보 game_id 목록
CREATE OR REPLACE FUNCTION public._fun_wc_pool(p_filter jsonb)
RETURNS SETOF integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT g.id
  FROM public.games g
  WHERE (p_filter->>'category' IS NULL OR g.category = p_filter->>'category')
    AND (NOT COALESCE((p_filter->>'rentable_only')::boolean, false) OR COALESCE(g.is_rentable, true))
    AND (NOT COALESCE((p_filter->>'require_image')::boolean, false) OR NULLIF(btrim(g.image), '') IS NOT NULL)
    AND (
      jsonb_typeof(p_filter->'genres_any') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_filter->'genres_any') = 0
      OR g.genres && ARRAY(SELECT jsonb_array_elements_text(p_filter->'genres_any'))
    )
$$;

-- 집계 대상 판: 완료 + (회원 범위면 회원만) + 개발자(tester) 제외
CREATE OR REPLACE FUNCTION public._fun_wc_eligible_runs(p_theme_id uuid, p_scope text)
RETURNS SETOF public.fun_worldcup_runs
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT r.*
  FROM public.fun_worldcup_runs r
  WHERE r.theme_id = p_theme_id
    AND r.status = 'finished'
    AND (p_scope = 'all' OR r.is_member)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = r.user_id AND ur.role_key = 'tester'
    )
$$;

-- 게임별 승·패·등장·우승 수
CREATE OR REPLACE FUNCTION public._fun_wc_game_stats(p_theme_id uuid, p_scope text)
RETURNS TABLE(game_id integer, wins bigint, losses bigint, appearances bigint, championships bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH er AS (
    SELECT * FROM public._fun_wc_eligible_runs(p_theme_id, p_scope)
  ),
  m AS (
    SELECT m.* FROM public.fun_worldcup_matches m JOIN er ON er.id = m.run_id
  ),
  wl AS (
    SELECT winner_game_id AS gid, 1 AS w, 0 AS l FROM m
    UNION ALL
    SELECT CASE WHEN winner_game_id = top_game_id THEN bottom_game_id ELSE top_game_id END, 0, 1 FROM m
  ),
  ap AS (SELECT unnest(bracket) AS gid FROM er),
  a AS (SELECT gid, count(*) AS appearances FROM ap GROUP BY gid),
  w AS (SELECT gid, sum(w)::bigint AS wins, sum(l)::bigint AS losses FROM wl GROUP BY gid),
  c AS (SELECT champion_game_id AS gid, count(*) AS champs FROM er GROUP BY champion_game_id)
  SELECT a.gid, COALESCE(w.wins, 0), COALESCE(w.losses, 0), a.appearances, COALESCE(c.champs, 0)
  FROM a
  LEFT JOIN w USING (gid)
  LEFT JOIN c USING (gid)
$$;

REVOKE EXECUTE ON FUNCTION public._fun_wc_pool(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._fun_wc_eligible_runs(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._fun_wc_game_stats(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 공개 RPC ────────────────────────────────────────────────────

-- 활성 테마 목록 (후보 16개 미만 테마는 숨김)
CREATE OR REPLACE FUNCTION public.fun_wc_list_themes()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'slug', x.slug, 'title', x.title, 'description', x.description,
             'allowed_sizes', to_jsonb(x.allowed_sizes),
             'pool_count', x.pool_count, 'play_count', x.play_count
           ) ORDER BY x.sort_order, x.created_at), '[]'::jsonb)
  FROM (
    SELECT t.*,
      (SELECT count(*) FROM public._fun_wc_pool(t.filter)) AS pool_count,
      (SELECT count(*) FROM public.fun_worldcup_runs r
        WHERE r.theme_id = t.id AND r.status = 'finished') AS play_count
    FROM public.fun_worldcup_themes t
    WHERE t.is_active
  ) x
  WHERE x.pool_count >= 16
$$;

-- 판 시작: 서버가 후보를 뽑고 대진·위아래 배치를 정해 발급
CREATE OR REPLACE FUNCTION public.fun_wc_start(p_slug text, p_size integer, p_anon_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_theme   public.fun_worldcup_themes%ROWTYPE;
  v_recent  integer;
  v_bracket integer[];
  v_top     boolean[];
  v_run_id  uuid;
BEGIN
  IF v_uid IS NULL AND p_anon_id IS NULL THEN
    RAISE EXCEPTION '기기 식별자가 필요합니다.';
  END IF;

  SELECT * INTO v_theme FROM public.fun_worldcup_themes WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '월드컵을 찾을 수 없습니다.'; END IF;

  IF p_size IS NULL OR NOT (p_size = ANY (v_theme.allowed_sizes)) THEN
    RAISE EXCEPTION '지원하지 않는 강수입니다.';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.fun_worldcup_runs
  WHERE started_at > now() - interval '1 hour'
    AND ((v_uid IS NOT NULL AND user_id = v_uid)
      OR (p_anon_id IS NOT NULL AND anon_id = p_anon_id));
  IF v_recent >= 20 THEN
    RAISE EXCEPTION '너무 많이 시작했어요. 잠시 후 다시 해 주세요.';
  END IF;

  SELECT array_agg(p.id) INTO v_bracket
  FROM (
    SELECT id FROM public._fun_wc_pool(v_theme.filter) AS pool(id)
    ORDER BY random()
    LIMIT p_size
  ) p;
  IF COALESCE(cardinality(v_bracket), 0) < p_size THEN
    RAISE EXCEPTION '후보가 부족합니다.';
  END IF;

  SELECT array_agg(random() < 0.5) INTO v_top FROM generate_series(1, p_size - 1);

  INSERT INTO public.fun_worldcup_runs (theme_id, size, bracket, top_first, user_id, anon_id, is_member)
  VALUES (v_theme.id, p_size, v_bracket, v_top, v_uid, p_anon_id, v_uid IS NOT NULL)
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'slug', v_theme.slug,
    'title', v_theme.title,
    'size', p_size,
    'top_first', to_jsonb(v_top),
    'candidates', (
      SELECT jsonb_agg(jsonb_build_object(
               'id', g.id, 'name', g.name, 'image', g.image,
               'min_players', g.min_players, 'max_players', g.max_players,
               'playingtime', g.playingtime
             ) ORDER BY b.ord)
      FROM unnest(v_bracket) WITH ORDINALITY AS b(id, ord)
      JOIN public.games g ON g.id = b.id
    )
  );
END;
$$;

-- 판 결과: 대진 순서대로 계산된 대결별 선택 (공유 링크용, 식별자는 내려주지 않음)
CREATE OR REPLACE FUNCTION public.fun_wc_get_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_run    public.fun_worldcup_runs%ROWTYPE;
  v_theme  public.fun_worldcup_themes%ROWTYPE;
  v_total  bigint;
  v_stats  record;
BEGIN
  SELECT * INTO v_run FROM public.fun_worldcup_runs WHERE id = p_run_id AND status = 'finished';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_theme FROM public.fun_worldcup_themes WHERE id = v_run.theme_id;

  SELECT count(*) INTO v_total FROM public._fun_wc_eligible_runs(v_run.theme_id, 'all');
  SELECT * INTO v_stats FROM public._fun_wc_game_stats(v_run.theme_id, 'all') s
  WHERE s.game_id = v_run.champion_game_id;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'slug', v_theme.slug,
    'title', v_theme.title,
    'size', v_run.size,
    'finished_at', v_run.finished_at,
    'champion', (
      SELECT jsonb_build_object(
        'id', v_run.champion_game_id, 'name', g.name, 'image', g.image,
        'min_players', g.min_players, 'max_players', g.max_players, 'playingtime', g.playingtime)
      FROM (SELECT 1) one LEFT JOIN public.games g ON g.id = v_run.champion_game_id
    ),
    'champion_stats', jsonb_build_object(
      'total_runs', v_total,
      'championships', COALESCE(v_stats.championships, 0),
      'wins', COALESCE(v_stats.wins, 0),
      'losses', COALESCE(v_stats.losses, 0)
    ),
    -- 우승작이 이긴 상대 (큰 라운드부터)
    'path', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'round_size', m.round_size,
               'opponent', jsonb_build_object('id', o.id, 'name', o.name, 'image', o.image)
             ) ORDER BY m.round_size DESC), '[]'::jsonb)
      FROM public.fun_worldcup_matches m
      LEFT JOIN public.games o ON o.id = CASE WHEN m.winner_game_id = m.top_game_id
                                              THEN m.bottom_game_id ELSE m.top_game_id END
      WHERE m.run_id = v_run.id AND m.winner_game_id = v_run.champion_game_id
    )
  );
END;
$$;

-- 판 제출: 대진과 맞는지 검증 후 1:1 대결 일괄 기록
-- p_picks = 대결 순서대로 [{ "w": 승자 game_id, "ms": 고르는 데 걸린 ms }]
CREATE OR REPLACE FUNCTION public.fun_wc_finish(p_run_id uuid, p_picks jsonb, p_anon_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_run    public.fun_worldcup_runs%ROWTYPE;
  v_cur    integer[];
  v_next   integer[];
  v_len    integer;
  v_idx    integer := 0;
  v_pick   jsonb;
  v_a      integer;
  v_b      integer;
  v_w      integer;
  v_top    integer;
  v_bottom integer;
  v_ms     integer;
BEGIN
  SELECT * INTO v_run FROM public.fun_worldcup_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '판을 찾을 수 없습니다.'; END IF;

  IF NOT ((v_uid IS NOT NULL AND v_run.user_id = v_uid)
       OR (p_anon_id IS NOT NULL AND v_run.anon_id = p_anon_id)) THEN
    RAISE EXCEPTION '이 판을 제출할 권한이 없습니다.';
  END IF;

  IF v_run.status <> 'started' THEN RAISE EXCEPTION '이미 끝난 판입니다.'; END IF;

  IF jsonb_typeof(p_picks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_picks) <> v_run.size - 1 THEN
    RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
  END IF;

  v_cur := v_run.bracket;
  WHILE cardinality(v_cur) > 1 LOOP
    v_len := cardinality(v_cur);
    v_next := '{}';
    FOR i IN 1 .. v_len / 2 LOOP
      v_a := v_cur[2 * i - 1];
      v_b := v_cur[2 * i];
      v_pick := p_picks -> v_idx;

      IF jsonb_typeof(v_pick->'w') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
      END IF;
      v_w := (v_pick->>'w')::integer;
      IF v_w IS DISTINCT FROM v_a AND v_w IS DISTINCT FROM v_b THEN
        RAISE EXCEPTION '선택 기록이 대진과 맞지 않습니다.';
      END IF;

      IF v_run.top_first[v_idx + 1] THEN
        v_top := v_a; v_bottom := v_b;
      ELSE
        v_top := v_b; v_bottom := v_a;
      END IF;

      v_ms := CASE WHEN jsonb_typeof(v_pick->'ms') = 'number'
                   THEN LEAST(GREATEST((v_pick->>'ms')::numeric, 0), 600000)::integer END;

      INSERT INTO public.fun_worldcup_matches
        (run_id, round_size, match_no, top_game_id, bottom_game_id, winner_game_id, picked_top, decide_ms)
      VALUES (v_run.id, v_len, i, v_top, v_bottom, v_w, v_w = v_top, v_ms);

      v_next := v_next || v_w;
      v_idx := v_idx + 1;
    END LOOP;
    v_cur := v_next;
  END LOOP;

  UPDATE public.fun_worldcup_runs
  SET status = 'finished', champion_game_id = v_cur[1], finished_at = now()
  WHERE id = v_run.id;

  RETURN public.fun_wc_get_run(v_run.id);
END;
$$;

-- 랭킹: 기본 정렬은 1:1 승률 (표본 20경기 이상만 순위)
CREATE OR REPLACE FUNCTION public.fun_wc_ranking(p_slug text, p_scope text DEFAULT 'member')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_theme public.fun_worldcup_themes%ROWTYPE;
  v_total bigint;
  c_min_matches constant integer := 20;
BEGIN
  IF p_scope NOT IN ('member', 'all') THEN RAISE EXCEPTION '집계 범위가 올바르지 않습니다.'; END IF;

  SELECT * INTO v_theme FROM public.fun_worldcup_themes WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '월드컵을 찾을 수 없습니다.'; END IF;

  SELECT count(*) INTO v_total FROM public._fun_wc_eligible_runs(v_theme.id, p_scope);

  RETURN jsonb_build_object(
    'slug', v_theme.slug,
    'title', v_theme.title,
    'scope', p_scope,
    'total_runs', v_total,
    'min_matches', c_min_matches,
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', s.game_id, 'name', g.name, 'image', g.image,
               'wins', s.wins, 'losses', s.losses,
               'win_rate', CASE WHEN s.wins + s.losses > 0
                                THEN round(s.wins::numeric / (s.wins + s.losses), 4) END,
               'appearances', s.appearances,
               'championships', s.championships,
               'champion_rate', round(s.championships::numeric / s.appearances, 4),
               'ranked', s.wins + s.losses >= c_min_matches
             ) ORDER BY (s.wins + s.losses >= c_min_matches) DESC,
                        s.wins::numeric / NULLIF(s.wins + s.losses, 0) DESC NULLS LAST,
                        s.wins DESC), '[]'::jsonb)
      FROM public._fun_wc_game_stats(v_theme.id, p_scope) s
      JOIN public.games g ON g.id = s.game_id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fun_wc_list_themes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fun_wc_start(text, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fun_wc_get_run(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fun_wc_finish(uuid, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fun_wc_ranking(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fun_wc_list_themes() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_start(text, integer, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_get_run(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_finish(uuid, jsonb, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_ranking(text, text) TO anon, authenticated;
