-- ================================================================
-- MIGRATION: fun_worldcup_min_matches_10
-- 날짜: 2026-09-29
-- 배경: 랭킹 순위 표본 기준 20경기 → 10경기 (사용자 결정). 동아리 규모에서 20경기는 너무 늦게 찬다.
-- ================================================================

CREATE OR REPLACE FUNCTION public.fun_wc_ranking(p_slug text, p_scope text DEFAULT 'member'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_theme public.fun_worldcup_themes%ROWTYPE;
  v_total bigint;
  c_min_matches constant integer := 10;
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
$function$
;
