-- ================================================================
-- MIGRATION: fun_quiz_delete
-- 날짜: 2026-10-01
-- 배경: 회원이 자기 성향검사 결과를 지울 수 있게 한다 (spec_fun_quiz.md §7).
--   한 건 삭제 / 내 기록 전체 삭제. 남의 결과는 지울 수 없다.
--   최신 결과를 지우면 리뷰 배지는 그다음 최신 결과로 바뀌고, 다 지우면 배지가 사라진다.
--   전체 삭제 때는 리뷰 공개 설정도 함께 지운다(다시 검사해도 기본 비공개에서 시작).
-- ================================================================

CREATE OR REPLACE FUNCTION public.fun_quiz_delete_result(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  DELETE FROM public.fun_quiz_responses WHERE id = p_id AND user_id = v_uid;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fun_quiz_delete_all_mine()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  DELETE FROM public.fun_quiz_responses WHERE user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.fun_quiz_public WHERE user_id = v_uid;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fun_quiz_delete_result(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_quiz_delete_all_mine() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fun_quiz_delete_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_quiz_delete_all_mine() TO authenticated;
