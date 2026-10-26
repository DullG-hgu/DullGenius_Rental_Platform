-- ================================================================
-- MIGRATION: 월드컵 웨이트 범위 설정 (체크로 고르는 BGG 웨이트 구간)
-- 날짜: 2026-10-26
-- 구간: w1 <1.5 · w2 1.5~2.0 · w3 2.0~2.5 · w4 2.5~3.0 · w5 3.0+ (하한 포함·상한 미포함)
--   전부 체크(= NULL) 는 지금과 같다 — 웨이트 없는 게임도 후보. 일부만 고르면 웨이트 없는 게임은 빠진다
-- 화면은 fun_wc_list_themes 의 weight_counts·all_sizes 로 후보 수·강수를 직접 계산하고(체크마다 서버 호출 안 함),
--   fun_wc_start 가 같은 규칙으로 다시 검증한다
-- 이전 프런트 호환: fun_wc_start 의 p_weights 는 기본값 NULL, list_themes 는 필드만 추가
-- 웨이트 테마 3개(10/26 오전, 0판)는 끈다 → 테마가 다시 하나라 설정 화면이 바로 뜬다
-- ================================================================

ALTER TABLE public.fun_worldcup_runs ADD COLUMN IF NOT EXISTS weights text[];
COMMENT ON COLUMN public.fun_worldcup_runs.weights IS '웨이트 범위 설정 (w1~w5). NULL = 전부';

CREATE OR REPLACE FUNCTION public._fun_wc_weight_key(p_difficulty numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_difficulty IS NULL THEN 'none'
    WHEN p_difficulty < 1.5 THEN 'w1'
    WHEN p_difficulty < 2.0 THEN 'w2'
    WHEN p_difficulty < 2.5 THEN 'w3'
    WHEN p_difficulty < 3.0 THEN 'w4'
    ELSE 'w5'
  END
$function$;

-- 잘못된 값은 거부, 중복 제거·정렬, 비었거나 다섯 개 전부면 NULL(= 조건 없음)
CREATE OR REPLACE FUNCTION public._fun_wc_norm_weights(p_weights text[])
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v text[];
BEGIN
  IF p_weights IS NULL OR cardinality(p_weights) = 0 THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_weights) x WHERE x IS NULL OR x NOT IN ('w1','w2','w3','w4','w5')) THEN
    RAISE EXCEPTION '웨이트 범위가 올바르지 않습니다.';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v FROM unnest(p_weights) x;
  IF cardinality(v) = 5 THEN RETURN NULL; END IF;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public._fun_wc_pool_for(p_filter jsonb, p_players integer, p_weights text[])
 RETURNS SETOF integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.id
  FROM public._fun_wc_pool_for(p_filter, p_players) AS p(id)
  JOIN public.games g ON g.id = p.id
  WHERE p_weights IS NULL OR public._fun_wc_weight_key(g.difficulty) = ANY (p_weights)
$function$;

REVOKE EXECUTE ON FUNCTION public._fun_wc_weight_key(numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._fun_wc_norm_weights(text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._fun_wc_pool_for(jsonb, integer, text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fun_wc_list_themes(p_players integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'slug', x.slug, 'title', x.title, 'description', x.description,
             'players', p_players,
             'allowed_sizes', (SELECT COALESCE(jsonb_agg(n ORDER BY n), '[]'::jsonb)
                               FROM unnest(x.allowed_sizes) n WHERE x.pool_count * 2 > n),
             'all_sizes', to_jsonb(x.allowed_sizes),
             'weight_counts', x.weight_counts,
             'pool_count', x.pool_count, 'total_pool_count', x.total_pool_count, 'play_count', x.play_count
           ) ORDER BY x.sort_order, x.created_at), '[]'::jsonb)
  FROM (
    SELECT t.*,
      (SELECT count(*) FROM public._fun_wc_pool_for(t.filter, p_players)) AS pool_count,
      (SELECT count(*) FROM public._fun_wc_pool(t.filter)) AS total_pool_count,
      -- 웨이트 범위 체크용: 인원 조건까지 적용한 구간별 후보 수 (none = 웨이트 없음, 전부 체크일 때만 후보)
      (SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
         SELECT public._fun_wc_weight_key(g.difficulty) k, count(*) n
         FROM public._fun_wc_pool_for(t.filter, p_players) AS p(id) JOIN public.games g ON g.id = p.id
         GROUP BY 1) w) AS weight_counts,
      (SELECT count(*) FROM public.fun_worldcup_runs r
        WHERE r.theme_id = t.id AND r.status = 'finished') AS play_count
    FROM public.fun_worldcup_themes t
    WHERE t.is_active
  ) x
  WHERE x.total_pool_count >= 16
    AND (p_players IS NULL OR p_players BETWEEN 1 AND 30)
$function$;

DROP FUNCTION public.fun_wc_start(text, integer, uuid, integer);
CREATE OR REPLACE FUNCTION public.fun_wc_start(p_slug text, p_size integer, p_anon_id uuid DEFAULT NULL::uuid, p_players integer DEFAULT NULL::integer, p_weights text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_weights   text[] := public._fun_wc_norm_weights(p_weights);
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

  SELECT count(*) INTO v_pool FROM public._fun_wc_pool_for(v_theme.filter, p_players, v_weights);
  IF v_pool * 2 <= p_size THEN
    RAISE EXCEPTION '후보가 부족합니다.';
  END IF;

  v_n := LEAST(p_size, v_pool);
  v_pairs := p_size / 2;

  SELECT array_agg(p.id) INTO v_ids
  FROM (
    SELECT id FROM public._fun_wc_pool_for(v_theme.filter, p_players, v_weights) AS pool(id)
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

  INSERT INTO public.fun_worldcup_runs (theme_id, size, bracket, top_first, user_id, anon_id, is_member, players, weights)
  VALUES (v_theme.id, p_size, v_bracket, v_top, v_uid, p_anon_id, v_uid IS NOT NULL, p_players, v_weights)
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'slug', v_theme.slug,
    'title', v_theme.title,
    'size', p_size,
    'players', p_players,
    'weights', to_jsonb(v_weights),
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
$function$;

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
    'weights', to_jsonb(v_run.weights),
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

REVOKE EXECUTE ON FUNCTION public.fun_wc_start(text, integer, uuid, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fun_wc_start(text, integer, uuid, integer, text[]) TO anon, authenticated;

UPDATE public.fun_worldcup_themes SET is_active = false, updated_at = now()
WHERE slug IN ('weight-light', 'weight-medium', 'weight-heavy');
