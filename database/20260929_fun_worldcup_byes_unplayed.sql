-- ================================================================
-- MIGRATION: fun_worldcup_byes_unplayed
-- 날짜: 2026-09-29
-- 배경 (spec_fun_worldcup.md §4·§5 변경):
--   1) 256강까지 + 부전승: 후보가 강수보다 적으면 빈자리를 부전승(NULL)으로 채운다.
--      부전승은 첫 라운드에만, 한 대결에 최대 하나. 첫 라운드 절반 이상이 부전승이 되는 강수는 거부.
--      부전승 대결은 기록하지 않는다 (선호 정보가 없음).
--      top_first 는 모든 자리(부전승 포함) 순번, picks 는 실제 대결 순번으로 센다.
--   2) 「안 해봄」: 대결마다 위/아래 후보를 안 해봤다고 표시했는지 기록 (표시 없음 = 모름).
-- ================================================================

ALTER TABLE public.fun_worldcup_themes DROP CONSTRAINT fun_worldcup_themes_allowed_sizes_check;
ALTER TABLE public.fun_worldcup_themes ADD CONSTRAINT fun_worldcup_themes_allowed_sizes_check
  CHECK (allowed_sizes <@ '{4,8,16,32,64,128,256}'::int[] AND cardinality(allowed_sizes) > 0);

ALTER TABLE public.fun_worldcup_runs DROP CONSTRAINT fun_worldcup_runs_size_check;
ALTER TABLE public.fun_worldcup_runs ADD CONSTRAINT fun_worldcup_runs_size_check
  CHECK (size IN (4, 8, 16, 32, 64, 128, 256));

ALTER TABLE public.fun_worldcup_matches
  ADD COLUMN top_unplayed boolean NOT NULL DEFAULT false,
  ADD COLUMN bottom_unplayed boolean NOT NULL DEFAULT false;

-- 기본 테마: 128·256강 열기 (우리가 만든 시드 행 — 운영자 설정값 아님)
UPDATE public.fun_worldcup_themes SET allowed_sizes = '{8,16,32,64,128,256}', updated_at = now()
WHERE slug = 'all-boardgames' AND allowed_sizes = '{8,16,32,64}';

-- ── 판 시작: 부전승 자리 배치 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fun_wc_start(p_slug text, p_size integer, p_anon_id uuid DEFAULT NULL)
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

  SELECT count(*) INTO v_pool FROM public._fun_wc_pool(v_theme.filter);
  -- 부전승은 첫 라운드 대결마다 최대 하나 → 후보가 강수의 절반보다 많아야 한다
  IF v_pool * 2 <= p_size THEN
    RAISE EXCEPTION '후보가 부족합니다.';
  END IF;

  v_n := LEAST(p_size, v_pool);
  v_pairs := p_size / 2;

  SELECT array_agg(p.id) INTO v_ids
  FROM (
    SELECT id FROM public._fun_wc_pool(v_theme.filter) AS pool(id)
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

  INSERT INTO public.fun_worldcup_runs (theme_id, size, bracket, top_first, user_id, anon_id, is_member)
  VALUES (v_theme.id, p_size, v_bracket, v_top, v_uid, p_anon_id, v_uid IS NOT NULL)
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'slug', v_theme.slug,
    'title', v_theme.title,
    'size', p_size,
    'entrants', v_n,
    'top_first', to_jsonb(v_top),
    -- 대진 순서 그대로, 부전승 자리는 null
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

-- ── 선택 반영: 부전승 자동 통과 + 「안 해봄」 ─────────────────────────
-- p_picks 원소: { "w": 승자 id, "ms": 걸린 시간, "u": [안 해봄 표시한 id…] }
CREATE OR REPLACE FUNCTION public._fun_wc_apply_picks(p_run public.fun_worldcup_runs, p_picks jsonb)
RETURNS integer[]
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_real   integer := (SELECT count(*) FROM unnest(p_run.bracket) x WHERE x IS NOT NULL) - 1;
  v_n      integer;
  v_cur    integer[] := p_run.bracket;
  v_next   integer[];
  v_len    integer;
  v_pair   integer := 0;   -- 자리 순번 (부전승 포함) → top_first
  v_idx    integer := 0;   -- 실제 대결 순번 → p_picks
  v_pick   jsonb;
  v_a      integer;
  v_b      integer;
  v_w      integer;
  v_top    integer;
  v_bottom integer;
  v_ms     integer;
  v_u      jsonb;
BEGIN
  IF jsonb_typeof(p_picks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_picks) > v_real THEN
    RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
  END IF;
  v_n := jsonb_array_length(p_picks);

  WHILE cardinality(v_cur) > 1 LOOP
    v_len := cardinality(v_cur);
    v_next := '{}';
    FOR i IN 1 .. v_len / 2 LOOP
      v_a := v_cur[2 * i - 1];
      v_b := v_cur[2 * i];

      IF v_a IS NULL OR v_b IS NULL THEN
        -- 부전승: 기록 없이 통과
        v_next := array_append(v_next, COALESCE(v_a, v_b));
        v_pair := v_pair + 1;
        CONTINUE;
      END IF;

      EXIT WHEN v_idx >= v_n;
      v_pick := p_picks -> v_idx;

      IF jsonb_typeof(v_pick->'w') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
      END IF;
      v_w := (v_pick->>'w')::integer;
      IF v_w IS DISTINCT FROM v_a AND v_w IS DISTINCT FROM v_b THEN
        RAISE EXCEPTION '선택 기록이 대진과 맞지 않습니다.';
      END IF;

      IF p_run.top_first[v_pair + 1] THEN
        v_top := v_a; v_bottom := v_b;
      ELSE
        v_top := v_b; v_bottom := v_a;
      END IF;

      v_ms := CASE WHEN jsonb_typeof(v_pick->'ms') = 'number'
                   THEN LEAST(GREATEST((v_pick->>'ms')::numeric, 0), 600000)::integer END;
      v_u := CASE WHEN jsonb_typeof(v_pick->'u') = 'array' THEN v_pick->'u' ELSE '[]'::jsonb END;

      INSERT INTO public.fun_worldcup_matches
        (run_id, round_size, match_no, top_game_id, bottom_game_id, winner_game_id, picked_top, decide_ms,
         top_unplayed, bottom_unplayed)
      VALUES (p_run.id, v_len, i, v_top, v_bottom, v_w, v_w = v_top, v_ms,
              v_u @> jsonb_build_array(v_top), v_u @> jsonb_build_array(v_bottom))
      ON CONFLICT (run_id, round_size, match_no) DO NOTHING;

      IF NOT FOUND THEN
        PERFORM 1 FROM public.fun_worldcup_matches
        WHERE run_id = p_run.id AND round_size = v_len AND match_no = i AND winner_game_id = v_w;
        IF NOT FOUND THEN RAISE EXCEPTION '이미 기록된 선택과 다릅니다.'; END IF;
      END IF;

      v_next := array_append(v_next, v_w);
      v_pair := v_pair + 1;
      v_idx := v_idx + 1;
    END LOOP;

    EXIT WHEN cardinality(v_next) < v_len / 2;  -- 라운드 도중에 선택이 끝남
    v_cur := v_next;
  END LOOP;

  RETURN v_cur;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._fun_wc_apply_picks(public.fun_worldcup_runs, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 제출: 실제 대결 수 = 참가 후보 수 - 1 ───────────────────────────
CREATE OR REPLACE FUNCTION public.fun_wc_finish(p_run_id uuid, p_picks jsonb, p_anon_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_run   public.fun_worldcup_runs%ROWTYPE;
  v_final integer[];
BEGIN
  SELECT * INTO v_run FROM public.fun_worldcup_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '판을 찾을 수 없습니다.'; END IF;

  IF NOT ((v_uid IS NOT NULL AND v_run.user_id = v_uid)
       OR (p_anon_id IS NOT NULL AND v_run.anon_id = p_anon_id)) THEN
    RAISE EXCEPTION '이 판을 제출할 권한이 없습니다.';
  END IF;

  IF v_run.status <> 'started' THEN RAISE EXCEPTION '이미 끝난 판입니다.'; END IF;

  IF jsonb_typeof(p_picks) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_picks) <> (SELECT count(*) FROM unnest(v_run.bracket) x WHERE x IS NOT NULL) - 1 THEN
    RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
  END IF;

  v_final := public._fun_wc_apply_picks(v_run, p_picks);
  IF cardinality(v_final) <> 1 OR v_final[1] IS NULL THEN
    RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
  END IF;

  UPDATE public.fun_worldcup_runs
  SET status = 'finished', champion_game_id = v_final[1], finished_at = now()
  WHERE id = v_run.id;

  RETURN public.fun_wc_get_run(v_run.id);
END;
$$;

-- ── 게임별 통계: 부전승 자리 제외 + 「안 해봄」 표시된 대결의 승패 ───────────
DROP FUNCTION public._fun_wc_game_stats(uuid, text);
CREATE FUNCTION public._fun_wc_game_stats(p_theme_id uuid, p_scope text)
RETURNS TABLE(game_id integer, wins bigint, losses bigint, appearances bigint, championships bigint,
              unplayed_wins bigint, unplayed_losses bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH er AS (
    SELECT * FROM public._fun_wc_eligible_runs(p_theme_id, p_scope)
  ),
  any_run AS (
    SELECT r.id
    FROM public.fun_worldcup_runs r
    WHERE r.theme_id = p_theme_id
      AND (p_scope = 'all' OR r.is_member)
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = r.user_id AND ur.role_key = 'tester'
      )
  ),
  m AS (
    SELECT m.* FROM public.fun_worldcup_matches m JOIN any_run ON any_run.id = m.run_id
  ),
  sides AS (
    SELECT top_game_id AS gid, winner_game_id = top_game_id AS won, top_unplayed AS unplayed FROM m
    UNION ALL
    SELECT bottom_game_id, winner_game_id = bottom_game_id, bottom_unplayed FROM m
  ),
  a AS (SELECT gid, count(*) AS appearances
        FROM (SELECT unnest(bracket) AS gid FROM er) ap WHERE gid IS NOT NULL GROUP BY gid),
  w AS (SELECT gid,
               count(*) FILTER (WHERE won) AS wins,
               count(*) FILTER (WHERE NOT won) AS losses,
               count(*) FILTER (WHERE won AND unplayed) AS u_wins,
               count(*) FILTER (WHERE NOT won AND unplayed) AS u_losses
        FROM sides GROUP BY gid),
  c AS (SELECT champion_game_id AS gid, count(*) AS champs FROM er GROUP BY champion_game_id)
  SELECT gid, COALESCE(w.wins, 0), COALESCE(w.losses, 0), COALESCE(a.appearances, 0), COALESCE(c.champs, 0),
         COALESCE(w.u_wins, 0), COALESCE(w.u_losses, 0)
  FROM w
  FULL JOIN a USING (gid)
  LEFT JOIN c USING (gid)
$$;

REVOKE EXECUTE ON FUNCTION public._fun_wc_game_stats(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 결과: 참가 수·우승작 「안 해봄」 여부 ────────────────────────────
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
    'entrants', (SELECT count(*) FROM unnest(v_run.bracket) x WHERE x IS NOT NULL),
    'finished_at', v_run.finished_at,
    'champion', (
      SELECT jsonb_build_object(
        'id', v_run.champion_game_id, 'name', g.name, 'image', g.image,
        'min_players', g.min_players, 'max_players', g.max_players, 'playingtime', g.playingtime)
      FROM (SELECT 1) one LEFT JOIN public.games g ON g.id = v_run.champion_game_id
    ),
    -- 이 판에서 우승작을 「안 해봄」으로 표시한 적이 있는지
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
$$;

-- ── 랭킹: 「안 해봄」 승패 필드 추가 (화면은 아직 안 씀, 관리자 분석용) ─────
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
               'champion_rate', CASE WHEN s.appearances > 0
                                     THEN round(s.championships::numeric / s.appearances, 4) END,
               'unplayed_wins', s.unplayed_wins,
               'unplayed_losses', s.unplayed_losses,
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

-- ── 테마 목록: 부전승 규칙에 맞는 강수만 (후보 > 강수/2) ─────────────────
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
             'allowed_sizes', (SELECT COALESCE(jsonb_agg(n ORDER BY n), '[]'::jsonb)
                               FROM unnest(x.allowed_sizes) n WHERE x.pool_count * 2 > n),
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
