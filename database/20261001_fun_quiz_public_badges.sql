-- ================================================================
-- MIGRATION: fun_quiz_public_badges
-- 날짜: 2026-10-01
-- 배경: 리뷰 작성자 이름 옆에 성향검사 배지(4글자 코드)를 보여준다 (spec_fun_quiz.md §6).
--   기본은 비공개. 회원이 마이페이지에서 직접 켠 경우에만, 가장 최근 결과의 코드와 네 축 점수를 공개한다.
--   19개 응답·8축 점수는 계속 본인만 본다.
--
-- 접근 원칙: 테이블은 RLS 켬 + 정책 없음 + 직접 권한 없음. RPC 로만.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.fun_quiz_public (
  user_id     uuid PRIMARY KEY,
  is_public   boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fun_quiz_public ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fun_quiz_public FROM PUBLIC, anon, authenticated;

-- 내 공개 설정 (회원) — { is_public, latest: { code, four, created_at } | null }
CREATE OR REPLACE FUNCTION public.fun_quiz_my_public()
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
  RETURN jsonb_build_object(
    'is_public', coalesce((SELECT is_public FROM public.fun_quiz_public WHERE user_id = v_uid), false),
    'latest', (
      SELECT jsonb_build_object('id', id, 'code', code, 'four', to_jsonb(four), 'created_at', created_at)
      FROM public.fun_quiz_responses WHERE user_id = v_uid ORDER BY created_at DESC LIMIT 1
    )
  );
END;
$$;

-- 공개 켜기/끄기 (회원)
CREATE OR REPLACE FUNCTION public.fun_quiz_set_public(p_public boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF p_public IS NULL THEN RAISE EXCEPTION '공개 여부가 필요합니다.'; END IF;
  INSERT INTO public.fun_quiz_public (user_id, is_public, updated_at)
  VALUES (v_uid, p_public, now())
  ON CONFLICT (user_id) DO UPDATE SET is_public = EXCLUDED.is_public, updated_at = now();
  RETURN p_public;
END;
$$;

-- 리뷰 작성자 배지 (누구나) — 공개를 켠 회원의 최신 결과만: { "<user_id>": { code, four } }
-- 리뷰 목록처럼 비회원도 볼 수 있다. 한 번에 최대 100명.
CREATE OR REPLACE FUNCTION public.fun_quiz_public_badges(p_user_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN RETURN '{}'::jsonb; END IF;
  IF cardinality(p_user_ids) > 100 THEN RAISE EXCEPTION '한 번에 100명까지만 조회할 수 있습니다.'; END IF;
  RETURN coalesce((
    SELECT jsonb_object_agg(l.user_id::text, jsonb_build_object('code', l.code, 'four', to_jsonb(l.four)))
    FROM (
      SELECT DISTINCT ON (r.user_id) r.user_id, r.code, r.four
      FROM public.fun_quiz_responses r
      JOIN public.fun_quiz_public p ON p.user_id = r.user_id AND p.is_public
      WHERE r.user_id = ANY (p_user_ids)
      ORDER BY r.user_id, r.created_at DESC
    ) l
  ), '{}'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fun_quiz_my_public() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_quiz_set_public(boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_quiz_public_badges(uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fun_quiz_my_public() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_quiz_set_public(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_quiz_public_badges(uuid[]) TO anon, authenticated;
