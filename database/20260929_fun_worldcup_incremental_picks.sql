-- ================================================================
-- MIGRATION: fun_worldcup_incremental_picks
-- 날짜: 2026-09-29
-- 배경: 끝까지 안 하고 끄는 판의 1:1 대결도 모은다 (spec_fun_worldcup.md §11-3 변경).
--       화면이 고를 때마다 "지금까지의 선택 전체"를 fun_wc_record 로 보낸다(응답 대기 없음).
--       서버는 대진으로 처음부터 다시 검증하고 아직 없는 대결만 추가한다 → 중복·순서 뒤바뀜에 안전.
--       fun_wc_finish 는 같은 헬퍼로 빠진 대결을 채우고 우승만 확정한다.
--
-- 집계 기준 변경:
--   1:1 승·패  = 완료·진행 중·이탈 판의 대결 전부
--   등장·우승  = 완료 판만 (기존과 같음)
-- ================================================================

-- 선택 기록 반영 헬퍼: p_picks 앞부분을 대진대로 검증하며 없는 대결만 추가.
-- 반환: 마지막으로 반영된 라운드의 생존 후보 (전부 골랐으면 {우승자})
CREATE OR REPLACE FUNCTION public._fun_wc_apply_picks(p_run public.fun_worldcup_runs, p_picks jsonb)
RETURNS integer[]
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_n      integer;
  v_cur    integer[] := p_run.bracket;
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
  IF jsonb_typeof(p_picks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_picks) > p_run.size - 1 THEN
    RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
  END IF;
  v_n := jsonb_array_length(p_picks);

  WHILE cardinality(v_cur) > 1 AND v_idx < v_n LOOP
    v_len := cardinality(v_cur);
    v_next := '{}';
    FOR i IN 1 .. v_len / 2 LOOP
      EXIT WHEN v_idx >= v_n;
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

      IF p_run.top_first[v_idx + 1] THEN
        v_top := v_a; v_bottom := v_b;
      ELSE
        v_top := v_b; v_bottom := v_a;
      END IF;

      v_ms := CASE WHEN jsonb_typeof(v_pick->'ms') = 'number'
                   THEN LEAST(GREATEST((v_pick->>'ms')::numeric, 0), 600000)::integer END;

      INSERT INTO public.fun_worldcup_matches
        (run_id, round_size, match_no, top_game_id, bottom_game_id, winner_game_id, picked_top, decide_ms)
      VALUES (p_run.id, v_len, i, v_top, v_bottom, v_w, v_w = v_top, v_ms)
      ON CONFLICT (run_id, round_size, match_no) DO NOTHING;

      IF NOT FOUND THEN
        -- 이미 기록된 대결: 같은 선택이어야 한다 (되돌리기 없음)
        PERFORM 1 FROM public.fun_worldcup_matches
        WHERE run_id = p_run.id AND round_size = v_len AND match_no = i AND winner_game_id = v_w;
        IF NOT FOUND THEN RAISE EXCEPTION '이미 기록된 선택과 다릅니다.'; END IF;
      END IF;

      v_next := v_next || v_w;
      v_idx := v_idx + 1;
    END LOOP;
    -- 라운드 도중에 끝났으면 남은 앞 라운드 생존자는 의미 없으므로 v_next 만 돌려준다
    v_cur := v_next;
  END LOOP;

  RETURN v_cur;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._fun_wc_apply_picks(public.fun_worldcup_runs, jsonb) FROM PUBLIC, anon, authenticated;

-- 진행 중 기록 (화면이 고를 때마다 호출, 응답을 기다리지 않음)
-- 끝났거나 이탈 처리된 판이면 조용히 무시한다 (늦게 도착한 요청일 수 있음)
CREATE OR REPLACE FUNCTION public.fun_wc_record(p_run_id uuid, p_picks jsonb, p_anon_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run public.fun_worldcup_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.fun_worldcup_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '판을 찾을 수 없습니다.'; END IF;

  IF NOT ((v_uid IS NOT NULL AND v_run.user_id = v_uid)
       OR (p_anon_id IS NOT NULL AND v_run.anon_id = p_anon_id)) THEN
    RAISE EXCEPTION '이 판을 제출할 권한이 없습니다.';
  END IF;

  IF v_run.status <> 'started' THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_run.status);
  END IF;

  PERFORM public._fun_wc_apply_picks(v_run, p_picks);
  RETURN jsonb_build_object('ok', true, 'recorded', jsonb_array_length(p_picks));
END;
$$;

-- 판 제출: 빠진 대결을 채우고 우승 확정
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

  IF jsonb_typeof(p_picks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_picks) <> v_run.size - 1 THEN
    RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
  END IF;

  v_final := public._fun_wc_apply_picks(v_run, p_picks);

  UPDATE public.fun_worldcup_runs
  SET status = 'finished', champion_game_id = v_final[1], finished_at = now()
  WHERE id = v_run.id;

  RETURN public.fun_wc_get_run(v_run.id);
END;
$$;

-- 게임별 통계: 승·패는 모든 판의 대결, 등장·우승은 완료 판만
CREATE OR REPLACE FUNCTION public._fun_wc_game_stats(p_theme_id uuid, p_scope text)
RETURNS TABLE(game_id integer, wins bigint, losses bigint, appearances bigint, championships bigint)
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
  wl AS (
    SELECT winner_game_id AS gid, 1 AS w, 0 AS l FROM m
    UNION ALL
    SELECT CASE WHEN winner_game_id = top_game_id THEN bottom_game_id ELSE top_game_id END, 0, 1 FROM m
  ),
  a AS (SELECT gid, count(*) AS appearances FROM (SELECT unnest(bracket) AS gid FROM er) ap GROUP BY gid),
  w AS (SELECT gid, sum(w)::bigint AS wins, sum(l)::bigint AS losses FROM wl GROUP BY gid),
  c AS (SELECT champion_game_id AS gid, count(*) AS champs FROM er GROUP BY champion_game_id)
  SELECT gid, COALESCE(w.wins, 0), COALESCE(w.losses, 0), COALESCE(a.appearances, 0), COALESCE(c.champs, 0)
  FROM w
  FULL JOIN a USING (gid)
  LEFT JOIN c USING (gid)
$$;

-- 랭킹: champion_rate 는 등장 0이면 null (진행 중 판에서만 나온 게임)
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

-- 관리자 통계: 이탈 지점 분포 추가 (이탈 판이 마지막으로 도달한 라운드)
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
    ),
    dropped AS (
      -- 이탈 판: 기록된 대결 중 가장 작은 라운드 = 마지막으로 도달한 라운드 (대결 0개면 첫 라운드)
      SELECT r.size, COALESCE(min(m.round_size), r.size) AS reached_round, count(m.*) AS played
      FROM r LEFT JOIN m ON m.run_id = r.id
      WHERE r.status = 'abandoned'
      GROUP BY r.id, r.size
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
      'dropoff', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'size', size, 'reached_round', reached_round, 'runs', n, 'avg_played', avg_played)
                 ORDER BY size, reached_round DESC), '[]'::jsonb)
        FROM (SELECT size, reached_round, count(*) n, round(avg(played), 1) avg_played
              FROM dropped GROUP BY size, reached_round) x
      ),
      'matches', (SELECT count(*) FROM m),
      'matches_from_unfinished', (SELECT count(*) FROM m JOIN r ON r.id = m.run_id WHERE r.status <> 'finished'),
      'top_pick_rate', (SELECT round(avg(picked_top::int)::numeric, 4) FROM m),
      'median_decide_ms', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY decide_ms) FROM m WHERE decide_ms IS NOT NULL)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fun_wc_record(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fun_wc_record(uuid, jsonb, uuid) TO anon, authenticated;
