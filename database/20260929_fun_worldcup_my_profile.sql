-- ================================================================
-- MIGRATION: fun_worldcup_my_profile
-- 날짜: 2026-09-29
-- 배경: 「내 보드게임 취향」 리포트 — 로그인한 회원이 **자기 기록만** 본다 (auth.uid() 기준).
--   운영진이 특정 회원의 취향을 열람하는 경로는 만들지 않는다 (집계 통계만). spec §6-2
--   대상: 내 판 전부(완료·진행 중·이탈)의 1:1 대결. 우승작은 완료 판만.
-- ================================================================

CREATE OR REPLACE FUNCTION public.fun_wc_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;

  RETURN (
    WITH my_runs AS (
      SELECT * FROM public.fun_worldcup_runs WHERE user_id = v_uid
    ),
    sides AS (
      SELECT m.top_game_id AS gid, m.winner_game_id = m.top_game_id AS won, m.top_unplayed AS unplayed
      FROM public.fun_worldcup_matches m JOIN my_runs r ON r.id = m.run_id
      UNION ALL
      SELECT m.bottom_game_id, m.winner_game_id = m.bottom_game_id, m.bottom_unplayed
      FROM public.fun_worldcup_matches m JOIN my_runs r ON r.id = m.run_id
    ),
    per_game AS (
      SELECT gid,
             count(*) FILTER (WHERE won) AS wins,
             count(*) FILTER (WHERE NOT won) AS losses,
             bool_or(unplayed) AS ever_unplayed,
             count(*) FILTER (WHERE won AND unplayed) AS unplayed_wins
      FROM sides GROUP BY gid
    ),
    genre_sides AS (  -- 장르별: 내가 고른(이긴) 쪽 vs 안 고른 쪽
      SELECT btrim(gen) AS genre, s.won
      FROM sides s JOIN public.games g ON g.id = s.gid, unnest(g.genres) AS gen
      WHERE btrim(gen) <> ''
    ),
    genres AS (
      SELECT genre, count(*) FILTER (WHERE won) AS wins, count(*) AS total
      FROM genre_sides GROUP BY genre HAVING count(*) >= 3
    ),
    champs AS (
      SELECT champion_game_id AS gid, count(*) AS n, max(finished_at) AS last_at
      FROM my_runs WHERE status = 'finished' AND champion_game_id IS NOT NULL
      GROUP BY champion_game_id
    )
    SELECT jsonb_build_object(
      'runs_finished', (SELECT count(*) FROM my_runs WHERE status = 'finished'),
      'runs_total', (SELECT count(*) FROM my_runs),
      'matches', (SELECT count(*) FROM sides) / 2,
      'unplayed_marks', (SELECT count(*) FROM sides WHERE unplayed),
      -- 내가 가장 많이 고른 게임 (승수 → 승률)
      'top_picks', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', p.gid, 'name', g.name, 'image', g.image, 'wins', p.wins, 'losses', p.losses
               ) ORDER BY p.wins DESC, p.wins::numeric / (p.wins + p.losses) DESC), '[]'::jsonb)
        FROM (SELECT * FROM per_game WHERE wins > 0 ORDER BY wins DESC, wins::numeric / (wins + losses) DESC LIMIT 10) p
        JOIN public.games g ON g.id = p.gid
      ),
      -- 내 우승작 (최근 순)
      'champions', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', c.gid, 'name', g.name, 'image', g.image, 'times', c.n
               ) ORDER BY c.last_at DESC), '[]'::jsonb)
        FROM (SELECT * FROM champs ORDER BY last_at DESC LIMIT 10) c
        JOIN public.games g ON g.id = c.gid
      ),
      -- 안 해봤는데 끌린 게임 (「안 해봄」 표시하고도 이긴 게임)
      'curious', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', p.gid, 'name', g.name, 'image', g.image, 'wins', p.unplayed_wins
               ) ORDER BY p.unplayed_wins DESC), '[]'::jsonb)
        FROM (SELECT * FROM per_game WHERE unplayed_wins > 0 ORDER BY unplayed_wins DESC LIMIT 10) p
        JOIN public.games g ON g.id = p.gid
      ),
      -- 장르 취향: 그 장르 게임이 대결에 나왔을 때 내가 고른 비율 (3번 이상 나온 장르만)
      'genres', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'genre', genre, 'pick_rate', round(wins::numeric / total, 4), 'seen', total
               ) ORDER BY (wins + 1)::numeric / (total + 2) DESC, total DESC), '[]'::jsonb)
        -- 순위는 (고른 수+1)/(나온 수+2) 로 보정: 3번 나와 3번 고른 장르가 30번 중 25번보다 위로 튀지 않게
        FROM (SELECT * FROM genres ORDER BY (wins + 1)::numeric / (total + 2) DESC, total DESC LIMIT 8) x
      )
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fun_wc_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fun_wc_my_profile() TO authenticated;
