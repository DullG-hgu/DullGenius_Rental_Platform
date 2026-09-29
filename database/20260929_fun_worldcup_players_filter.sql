-- ================================================================
-- MIGRATION: fun_worldcup_players_filter
-- 날짜: 2026-09-29
-- 배경: "n명이서 뭐 하지?" — 인원을 고르면 그 인원으로 할 수 있는 게임만 후보로 뽑는다 (spec §3-3).
--   runs.players 에 기록해 두면 나중에 "n인 모임에서 뽑힌 게임" 통계로 쓸 수 있다.
--   fun_wc_start / fun_wc_list_themes 에 p_players 인자 추가 → 옛 시그니처는 DROP (PostgREST 오버로드 모호성 방지)
-- ================================================================

ALTER TABLE public.fun_worldcup_runs
  ADD COLUMN players integer CHECK (players BETWEEN 1 AND 30);

-- 테마 필터 + 인원 조건 (인원 정보가 없는 게임은 인원을 고른 경우 제외)
CREATE OR REPLACE FUNCTION public._fun_wc_pool_for(p_filter jsonb, p_players integer)
RETURNS SETOF integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p.id
  FROM public._fun_wc_pool(p_filter) AS p(id)
  JOIN public.games g ON g.id = p.id
  WHERE p_players IS NULL
     OR (g.min_players IS NOT NULL AND g.max_players IS NOT NULL
         AND g.min_players <= p_players AND g.max_players >= p_players)
$$;

REVOKE EXECUTE ON FUNCTION public._fun_wc_pool_for(jsonb, integer) FROM PUBLIC, anon, authenticated;

-- ── 테마 목록: 인원을 주면 그 인원 기준 후보 수·가능한 강수 ─────────────────
DROP FUNCTION public.fun_wc_list_themes();
CREATE FUNCTION public.fun_wc_list_themes(p_players integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'slug', x.slug, 'title', x.title, 'description', x.description,
             'players', p_players,
             'allowed_sizes', (SELECT COALESCE(jsonb_agg(n ORDER BY n), '[]'::jsonb)
                               FROM unnest(x.allowed_sizes) n WHERE x.pool_count * 2 > n),
             'pool_count', x.pool_count, 'total_pool_count', x.total_pool_count, 'play_count', x.play_count
           ) ORDER BY x.sort_order, x.created_at), '[]'::jsonb)
  FROM (
    SELECT t.*,
      (SELECT count(*) FROM public._fun_wc_pool_for(t.filter, p_players)) AS pool_count,
      (SELECT count(*) FROM public._fun_wc_pool(t.filter)) AS total_pool_count,
      (SELECT count(*) FROM public.fun_worldcup_runs r
        WHERE r.theme_id = t.id AND r.status = 'finished') AS play_count
    FROM public.fun_worldcup_themes t
    WHERE t.is_active
  ) x
  -- 테마 자체가 작으면 숨김 (인원 조건으로 줄어든 경우는 화면에서 "후보 부족" 안내)
  WHERE x.total_pool_count >= 16
    AND (p_players IS NULL OR p_players BETWEEN 1 AND 30)
$$;

-- ── 판 시작: 인원 조건 반영 ───────────────────────────────────────
DROP FUNCTION public.fun_wc_start(text, integer, uuid);
CREATE FUNCTION public.fun_wc_start(p_slug text, p_size integer, p_anon_id uuid DEFAULT NULL, p_players integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_theme     public.fun_worldcup_themes%ROWTYPE;
  v_recent    integer;
  v_pool      integer;
  v_n         integer;
  v_pairs     integer;
  v_ids       integer[];
  v_bye_pairs integer[];
  v_bracket   integer[] := '{}';
  v_k         integer := 1;
  v_top       boolean[];
  v_run_id    uuid;
BEGIN
  IF v_uid IS NULL AND p_anon_id IS NULL THEN
    RAISE EXCEPTION '기기 식별자가 필요합니다.';
  END IF;
  IF p_players IS NOT NULL AND (p_players < 1 OR p_players > 30) THEN
    RAISE EXCEPTION '인원이 올바르지 않습니다.';
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

  SELECT count(*) INTO v_pool FROM public._fun_wc_pool_for(v_theme.filter, p_players);
  IF v_pool * 2 <= p_size THEN
    RAISE EXCEPTION '후보가 부족합니다.';
  END IF;

  v_n := LEAST(p_size, v_pool);
  v_pairs := p_size / 2;

  SELECT array_agg(p.id) INTO v_ids
  FROM (
    SELECT id FROM public._fun_wc_pool_for(v_theme.filter, p_players) AS pool(id)
    ORDER BY random()
    LIMIT v_n
  ) p;

  SELECT COALESCE(array_agg(g), '{}') INTO v_bye_pairs
  FROM (SELECT g FROM generate_series(1, v_pairs) g ORDER BY random() LIMIT p_size - v_n) s;

  FOR p IN 1 .. v_pairs LOOP
    IF p = ANY (v_bye_pairs) THEN
      v_bracket := array_append(array_append(v_bracket, v_ids[v_k]), NULL::integer);
      v_k := v_k + 1;
    ELSE
      v_bracket := array_append(array_append(v_bracket, v_ids[v_k]), v_ids[v_k + 1]);
      v_k := v_k + 2;
    END IF;
  END LOOP;

  SELECT array_agg(random() < 0.5) INTO v_top FROM generate_series(1, p_size - 1);

  INSERT INTO public.fun_worldcup_runs (theme_id, size, bracket, top_first, user_id, anon_id, is_member, players)
  VALUES (v_theme.id, p_size, v_bracket, v_top, v_uid, p_anon_id, v_uid IS NOT NULL, p_players)
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'slug', v_theme.slug,
    'title', v_theme.title,
    'size', p_size,
    'players', p_players,
    'entrants', v_n,
    'top_first', to_jsonb(v_top),
    'candidates', (
      SELECT jsonb_agg(
               CASE WHEN b.id IS NULL THEN 'null'::jsonb
                    ELSE jsonb_build_object(
                      'id', g.id, 'name', g.name, 'image', g.image,
                      'min_players', g.min_players, 'max_players', g.max_players,
                      'playingtime', g.playingtime)
               END ORDER BY b.ord)
      FROM unnest(v_bracket) WITH ORDINALITY AS b(id, ord)
      LEFT JOIN public.games g ON g.id = b.id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fun_wc_list_themes(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fun_wc_start(text, integer, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fun_wc_list_themes(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_start(text, integer, uuid, integer) TO anon, authenticated;

-- ── 결과: 인원 포함 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fun_wc_get_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'players', v_run.players,
    'entrants', (SELECT count(*) FROM unnest(v_run.bracket) x WHERE x IS NOT NULL),
    'finished_at', v_run.finished_at,
    'champion', (
      SELECT jsonb_build_object(
        'id', v_run.champion_game_id, 'name', g.name, 'image', g.image,
        'min_players', g.min_players, 'max_players', g.max_players, 'playingtime', g.playingtime)
      FROM (SELECT 1) one LEFT JOIN public.games g ON g.id = v_run.champion_game_id
    ),
    'champion_unplayed', EXISTS (
      SELECT 1 FROM public.fun_worldcup_matches m
      WHERE m.run_id = v_run.id
        AND ((m.top_game_id = v_run.champion_game_id AND m.top_unplayed)
          OR (m.bottom_game_id = v_run.champion_game_id AND m.bottom_unplayed))
    ),
    'champion_stats', jsonb_build_object(
      'total_runs', v_total,
      'championships', COALESCE(v_stats.championships, 0),
      'wins', COALESCE(v_stats.wins, 0),
      'losses', COALESCE(v_stats.losses, 0)
    ),
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
$function$;
