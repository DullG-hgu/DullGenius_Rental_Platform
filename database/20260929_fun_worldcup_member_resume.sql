-- ================================================================
-- MIGRATION: fun_worldcup_member_resume
-- 날짜: 2026-09-29
-- 배경: 로그인 판은 3일 동안 이어하기 (다른 기기 포함). 비로그인 판은 기존대로 6시간 (spec §3-4).
--   이탈 처리 기준 분리 + 본인의 진행 중인 판을 서버 기록으로 되살리는 fun_wc_my_open_run.
-- ================================================================

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
  WHERE status = 'started'
    AND started_at < now() - CASE WHEN user_id IS NOT NULL THEN interval '3 days' ELSE interval '6 hours' END;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 본인의 가장 최근 진행 중인 판 (없으면 null). fun_wc_start 와 같은 모양 + picks·unplayed·last_activity
CREATE OR REPLACE FUNCTION public.fun_wc_my_open_run(p_slug text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_run    public.fun_worldcup_runs%ROWTYPE;
  v_theme  public.fun_worldcup_themes%ROWTYPE;
  v_cur    integer[];
  v_next   integer[];
  v_len    integer;
  v_a      integer;
  v_b      integer;
  v_m      public.fun_worldcup_matches%ROWTYPE;
  v_picks  jsonb := '[]';
  v_stop   boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;

  SELECT r.* INTO v_run
  FROM public.fun_worldcup_runs r
  JOIN public.fun_worldcup_themes t ON t.id = r.theme_id AND t.is_active
  WHERE r.user_id = v_uid AND r.status = 'started'
    AND r.started_at > now() - interval '3 days'
    AND (p_slug IS NULL OR t.slug = p_slug)
  ORDER BY r.started_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_theme FROM public.fun_worldcup_themes WHERE id = v_run.theme_id;

  -- 대진을 따라가며 기록된 대결을 선택 목록으로 되돌린다 (부전승은 선택이 아니므로 건너뜀)
  v_cur := v_run.bracket;
  WHILE cardinality(v_cur) > 1 AND NOT v_stop LOOP
    v_len := cardinality(v_cur);
    v_next := '{}';
    FOR i IN 1 .. v_len / 2 LOOP
      v_a := v_cur[2 * i - 1];
      v_b := v_cur[2 * i];
      IF v_a IS NULL OR v_b IS NULL THEN
        v_next := array_append(v_next, COALESCE(v_a, v_b));
        CONTINUE;
      END IF;
      SELECT * INTO v_m FROM public.fun_worldcup_matches
      WHERE run_id = v_run.id AND round_size = v_len AND match_no = i;
      IF NOT FOUND THEN v_stop := true; EXIT; END IF;
      v_picks := v_picks || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'w', v_m.winner_game_id,
        'ms', v_m.decide_ms,
        'u', NULLIF((SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
               SELECT v_m.top_game_id AS x WHERE v_m.top_unplayed
               UNION ALL SELECT v_m.bottom_game_id WHERE v_m.bottom_unplayed) u), '[]'::jsonb)
      )));
      v_next := array_append(v_next, v_m.winner_game_id);
    END LOOP;
    IF NOT v_stop THEN v_cur := v_next; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'run', jsonb_build_object(
      'run_id', v_run.id,
      'slug', v_theme.slug,
      'title', v_theme.title,
      'size', v_run.size,
      'players', v_run.players,
      'entrants', (SELECT count(*) FROM unnest(v_run.bracket) x WHERE x IS NOT NULL),
      'top_first', to_jsonb(v_run.top_first),
      'candidates', (
        SELECT jsonb_agg(
                 CASE WHEN b.id IS NULL THEN 'null'::jsonb
                      ELSE jsonb_build_object(
                        'id', g.id, 'name', g.name, 'image', g.image,
                        'min_players', g.min_players, 'max_players', g.max_players,
                        'playingtime', g.playingtime)
                 END ORDER BY b.ord)
        FROM unnest(v_run.bracket) WITH ORDINALITY AS b(id, ord)
        LEFT JOIN public.games g ON g.id = b.id
      )
    ),
    'picks', v_picks,
    -- 이 판에서 「안 해봄」 표시한 게임 전부
    'unplayed', (
      SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM (
        SELECT top_game_id AS x FROM public.fun_worldcup_matches WHERE run_id = v_run.id AND top_unplayed
        UNION ALL
        SELECT bottom_game_id FROM public.fun_worldcup_matches WHERE run_id = v_run.id AND bottom_unplayed
      ) u
    ),
    'last_activity', GREATEST(v_run.started_at,
      (SELECT max(created_at) FROM public.fun_worldcup_matches WHERE run_id = v_run.id))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fun_wc_my_open_run(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fun_wc_my_open_run(text) TO authenticated;
