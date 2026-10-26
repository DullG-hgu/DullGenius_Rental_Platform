-- ================================================================
-- MIGRATION: 월드컵 집계는 웨이트 전부 체크한 판만
-- 날짜: 2026-10-26
-- 배경: 웨이트 범위를 좁힌 판은 상대가 같은 무게끼리로 쏠려 승률·우승률이 왜곡된다
--   (3.0 이상만 고르면 19개 안에서만 겨룸). 기록은 남기고 집계(랭킹·결과 화면 통계·관리자 통계)에서만 뺀다.
--   인원 선택은 9/29 결정대로 섞어 둔다. 적용 시점에 웨이트로 고른 판은 0개라 기존 숫자는 그대로.
-- ================================================================

CREATE OR REPLACE FUNCTION public._fun_wc_eligible_runs(p_theme_id uuid, p_scope text)
 RETURNS SETOF fun_worldcup_runs
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.*
  FROM public.fun_worldcup_runs r
  WHERE r.theme_id = p_theme_id
    AND r.status = 'finished'
    AND r.weights IS NULL  -- 웨이트 범위를 좁힌 판은 집계 제외 (2026-10-26)
    AND (p_scope = 'all' OR r.is_member)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = r.user_id AND ur.role_key = 'tester'
    )
$function$;
