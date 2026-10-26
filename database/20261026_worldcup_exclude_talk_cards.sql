-- ================================================================
-- MIGRATION: 월드컵에서 질문·대화 카드 제외
-- 날짜: 2026-10-26
-- 배경: 동아리에서 실제로 쓰지 않는 질문·대화 카드가 후보에 섞여 1:1 승률 11~18%로 바닥.
--   「그러는 너는 어떤데?」 2종은 머더에 가깝고 해본 사람이 있어 남긴다 (운영 결정).
-- 방식: 정규 태그(format) 「대화 카드」 + 필터 tags_none. 모든 테마에 적용.
--   랭킹도 현재 후보만 노출한다 (전적은 보존).
-- ================================================================

INSERT INTO public.tags (name, layer, grp, sort) VALUES ('대화 카드', 'format', NULL, 2009)
ON CONFLICT (name) DO NOTHING;

-- 진실카드게임 · 칭찬 베이커리 · OX 카운팅 퀘스천카드 · 쿼스천 카드 클래식 · 캠프 파이어 퀘스천 카드 · 마음의 실타래
INSERT INTO public.game_tags (game_id, tag_id, source, confirmed)
SELECT g.id, t.id, 'operator', true
FROM public.games g CROSS JOIN public.tags t
WHERE t.name = '대화 카드' AND g.id IN (128, 132, 188, 149, 144, 257)
ON CONFLICT (game_id, tag_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public._fun_wc_pool(p_filter jsonb)
 RETURNS SETOF integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT g.id
  FROM public.games g
  WHERE g.base_game_id IS NULL  -- 확장판은 본판 없이 비교 대상이 아니므로 제외
    AND (p_filter->>'category' IS NULL OR g.category = p_filter->>'category')
    AND (NOT COALESCE((p_filter->>'rentable_only')::boolean, false) OR COALESCE(g.is_rentable, true))
    AND (NOT COALESCE((p_filter->>'require_image')::boolean, false) OR NULLIF(btrim(g.image), '') IS NOT NULL)
    AND (
      jsonb_typeof(p_filter->'genres_any') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_filter->'genres_any') = 0
      OR g.genres && ARRAY(SELECT jsonb_array_elements_text(p_filter->'genres_any'))
    )
    AND (p_filter->>'weight_min' IS NULL OR g.difficulty >= (p_filter->>'weight_min')::numeric)
    AND (p_filter->>'weight_max' IS NULL OR g.difficulty <  (p_filter->>'weight_max')::numeric)
    AND (
      jsonb_typeof(p_filter->'tags_any') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_filter->'tags_any') = 0
      OR EXISTS (
        SELECT 1 FROM public.game_tags gt JOIN public.tags t ON t.id = gt.tag_id
        WHERE gt.game_id = g.id
          AND (gt.confirmed OR gt.source <> 'jev')
          AND t.name IN (SELECT jsonb_array_elements_text(p_filter->'tags_any'))
      )
    )
    AND (
      jsonb_typeof(p_filter->'tags_none') IS DISTINCT FROM 'array'
      OR NOT EXISTS (
        SELECT 1 FROM public.game_tags gt JOIN public.tags t ON t.id = gt.tag_id
        WHERE gt.game_id = g.id
          AND (gt.confirmed OR gt.source <> 'jev')
          AND t.name IN (SELECT jsonb_array_elements_text(p_filter->'tags_none'))
      )
    )
$function$;

UPDATE public.fun_worldcup_themes
SET filter = filter || '{"tags_none":["대화 카드"]}'::jsonb, updated_at = now()
WHERE NOT (filter ? 'tags_none');

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
      WHERE g.base_game_id IS NULL  -- 과거 판의 확장판 전적은 보존하되 랭킹에는 노출하지 않는다
        AND s.game_id IN (SELECT p.id FROM public._fun_wc_pool(v_theme.filter) AS p(id))  -- 후보에서 뺀 게임은 전적만 남기고 숨긴다 (10/26 대화 카드)
    )
  );
END;
$function$;
