-- ================================================================
-- MIGRATION: 월드컵 테마 필터 — BGG 웨이트 구간 · 정규 태그
-- 날짜: 2026-10-26
-- 필터 키 추가 (없으면 조건 없음, 기존 테마 후보는 그대로):
--   weight_min  : games.difficulty >= 값   (웨이트 없는 게임은 제외)
--   weight_max  : games.difficulty <  값   (상한은 미포함 → 구간이 겹치지 않는다)
--   tags_any    : game_tags 에 이름이 하나라도 있는 게임 (미확정 jev 제안은 제외)
-- ================================================================

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
$function$;

-- 웨이트 테마 3개 (2026-10-26 운영 적용, 후보 71 / 47 / 54)
INSERT INTO public.fun_worldcup_themes (slug, title, description, filter, allowed_sizes, is_active, sort_order) VALUES
 ('weight-light',  '가볍게 한 판',     'BGG 웨이트 1.5 미만 — 설명 5분이면 시작',      '{"category":"보드게임","require_image":true,"weight_max":1.5}', '{8,16,32,64,128,256}', true, 10),
 ('weight-medium', '적당히 머리 쓰는 판', 'BGG 웨이트 1.5~2.0 — 가볍지만 고민 한 스푼',   '{"category":"보드게임","require_image":true,"weight_min":1.5,"weight_max":2.0}', '{8,16,32,64,128,256}', true, 11),
 ('weight-heavy',  '묵직한 한 판',     'BGG 웨이트 2.0 이상 — 긴 고민 끝의 한 수',      '{"category":"보드게임","require_image":true,"weight_min":2.0}', '{8,16,32,64,128,256}', true, 12)
ON CONFLICT DO NOTHING;
