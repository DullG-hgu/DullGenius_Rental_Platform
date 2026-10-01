-- ================================================================
-- MIGRATION: fun_quiz
-- 날짜: 2026-10-01
-- 배경: 놀이 콘텐츠 2탄 — 보드게임 성향검사 (spec_fun_quiz.md)
--   로그인 회원만 응시. 클라이언트는 19개 응답만 보내고, 서버가 채점해 저장한 뒤 결과를 돌려준다.
--   회원은 자기 결과만, 운영진(is_admin)은 집계만 본다.
--
-- 접근 원칙: 테이블은 RLS 켬 + 정책 없음 + 직접 권한 없음. 읽기·쓰기는 아래 SECURITY DEFINER RPC 로만.
-- 가중치 원본: boardgame/mbti/design (export_web.py 출력). src/fun/quiz/quizData.js 와 같아야 한다
--   (tests/fun-quiz-score.test.js 가 대조).
-- ================================================================

CREATE TABLE IF NOT EXISTS public.fun_quiz_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  answers       smallint[] NOT NULL CHECK (cardinality(answers) = 19),
  eight         numeric[] NOT NULL CHECK (cardinality(eight) = 8),
  four          numeric[] NOT NULL CHECK (cardinality(four) = 4),
  code          text NOT NULL CHECK (code ~ '^[LD·][PB·][TV·][SC·]$'),
  version       text NOT NULL,
  consented_at  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fun_quiz_responses_user_created_idx ON public.fun_quiz_responses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fun_quiz_responses_created_idx ON public.fun_quiz_responses (created_at);

ALTER TABLE public.fun_quiz_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fun_quiz_responses FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- 채점 (내부용). 응답 −2(A)…+2(B) × 19 → 8축·4축(−1~+1)·코드
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fun_quiz_score(p_answers smallint[])
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  -- 문항 19 × 8축(통제·정보·상호작용·편·속도·흐름·몰입·답). 원본 items-easy.csv
  w numeric[] := ARRAY[ARRAY[0,0,0,2,0,0,0,0],ARRAY[0,0,0,0,0,0,2,0],ARRAY[-1,0,0,0,-2,0,0,0],ARRAY[0,0,0,-2,0,0,0,0],ARRAY[0,0,0,0,1,2,0,0],ARRAY[0,2,0,0,0,0,0,0],ARRAY[0,0,0,2,0,0,0,0],ARRAY[0,0,0,0,0,0,0,2],ARRAY[0,0,0,0,0,0,-2,0],ARRAY[-2,0,0,0,0,-2,0,0],ARRAY[0,0,2,0,0,0,0,0],ARRAY[0,0,0,-2,0,0,0,0],ARRAY[0,0,0,0,0,0,0,-2],ARRAY[2,0,0,0,0,0,0,0],ARRAY[1,0,0,0,2,0,0,0],ARRAY[0,-2,0,0,0,0,0,0],ARRAY[0,0,0,0,0,0,0,2],ARRAY[0,0,-2,0,-1,0,0,0],ARRAY[0,0,0,0,0,0,0,-2]]::numeric[];
  -- 표시 4축 × 8축. 가볍게/진지하게 · 사람/판 · 함께/대결 · 정답/창작. 원본 axes.py
  d numeric[] := ARRAY[ARRAY[0.5,0,0,0,1,1,0,0],ARRAY[0,1,1,0,0,0,0,0],ARRAY[0,0,0,1,0,0,0.5,0],ARRAY[0,0,0,0,0,0,0,1]]::numeric[];
  lo text[] := ARRAY['L','P','T','S'];
  hi text[] := ARRAY['D','B','V','C'];
  eight numeric[] := '{}';
  four numeric[] := '{}';
  code text := '';
  s numeric; t numeric; i int; k int;
BEGIN
  IF p_answers IS NULL OR cardinality(p_answers) <> 19 THEN
    RAISE EXCEPTION '응답은 19개여야 합니다.';
  END IF;
  FOR i IN 1..19 LOOP
    IF p_answers[i] IS NULL OR p_answers[i] NOT BETWEEN -2 AND 2 THEN
      RAISE EXCEPTION '응답 값은 -2에서 2 사이여야 합니다.';
    END IF;
  END LOOP;

  FOR k IN 1..8 LOOP
    s := 0; t := 0;
    FOR i IN 1..19 LOOP
      s := s + p_answers[i] * w[i][k];
      t := t + abs(w[i][k]);
    END LOOP;
    eight := eight || CASE WHEN t = 0 THEN 0 ELSE s / t END;
  END LOOP;

  FOR i IN 1..4 LOOP
    s := 0; t := 0;
    FOR k IN 1..8 LOOP
      s := s + d[i][k] * eight[k];
      t := t + abs(d[i][k]);
    END LOOP;
    four := four || (s / t);
    code := code || CASE WHEN s / t >= 0.25 THEN hi[i] WHEN s / t <= -0.25 THEN lo[i] ELSE '·' END;
  END LOOP;

  RETURN jsonb_build_object(
    'eight', (SELECT jsonb_agg(round(x, 4)) FROM unnest(eight) x),
    'four',  (SELECT jsonb_agg(round(x, 4)) FROM unnest(four) x),
    'code',  code
  );
END;
$$;

-- ----------------------------------------------------------------
-- 응답 제출 (회원). 동의 필수, 1분에 1건 제한. 저장된 결과를 돌려준다.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fun_quiz_submit(p_answers smallint[], p_consent boolean, p_version text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_score jsonb;
  v_row public.fun_quiz_responses;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF p_consent IS NOT TRUE THEN RAISE EXCEPTION '저장 동의가 필요합니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.fun_quiz_responses
             WHERE user_id = v_uid AND created_at > now() - interval '1 minute') THEN
    RAISE EXCEPTION '잠시 후 다시 제출해 주세요.';
  END IF;

  v_score := public.fun_quiz_score(p_answers);

  INSERT INTO public.fun_quiz_responses (user_id, answers, eight, four, code, version, consented_at)
  VALUES (
    v_uid, p_answers,
    ARRAY(SELECT x::numeric FROM jsonb_array_elements_text(v_score->'eight') x),
    ARRAY(SELECT x::numeric FROM jsonb_array_elements_text(v_score->'four') x),
    v_score->>'code', left(coalesce(p_version, ''), 40), now()
  )
  RETURNING * INTO v_row;

  RETURN public.fun_quiz_result_json(v_row);
END;
$$;

-- 결과 JSON (내부용): 본인 결과 + 직전 결과(있으면)
CREATE OR REPLACE FUNCTION public.fun_quiz_result_json(p_row public.fun_quiz_responses)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'code', p_row.code,
    'four', to_jsonb(p_row.four),
    'eight', to_jsonb(p_row.eight),
    'answers', to_jsonb(p_row.answers),
    'created_at', p_row.created_at,
    'previous', (
      SELECT jsonb_build_object('id', p.id, 'code', p.code, 'four', to_jsonb(p.four), 'created_at', p.created_at)
      FROM public.fun_quiz_responses p
      WHERE p.user_id = p_row.user_id AND p.created_at < p_row.created_at
      ORDER BY p.created_at DESC
      LIMIT 1
    )
  );
$$;

-- ----------------------------------------------------------------
-- 본인 결과 조회 / 본인 기록 목록
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fun_quiz_get_result(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.fun_quiz_responses;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO v_row FROM public.fun_quiz_responses WHERE id = p_id AND user_id = v_uid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.fun_quiz_result_json(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.fun_quiz_my_results()
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
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'code', code, 'four', to_jsonb(four), 'created_at', created_at)
                     ORDER BY created_at DESC)
    FROM public.fun_quiz_responses WHERE user_id = v_uid
  ), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------
-- 운영진 통계: 기간 안에서 회원별 최신 1건 기준. 개인 결과는 내보내지 않는다.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fun_quiz_admin_stats(p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;

  RETURN (
    WITH ranged AS (
      SELECT * FROM public.fun_quiz_responses
      WHERE (p_from IS NULL OR created_at >= p_from) AND (p_to IS NULL OR created_at < p_to)
    ),
    latest AS (
      SELECT DISTINCT ON (user_id) * FROM ranged ORDER BY user_id, created_at DESC
    )
    SELECT jsonb_build_object(
      'responses', (SELECT count(*) FROM ranged),
      'members', (SELECT count(*) FROM latest),
      'by_code', coalesce((SELECT jsonb_object_agg(code, n) FROM (SELECT code, count(*) n FROM latest GROUP BY code) c), '{}'::jsonb),
      'four_avg', (SELECT jsonb_agg(round(avg_v, 3) ORDER BY i) FROM (
          SELECT i, avg(four[i]) avg_v FROM latest, generate_series(1, 4) i GROUP BY i) a),
      'eight_avg', (SELECT jsonb_agg(round(avg_v, 3) ORDER BY i) FROM (
          SELECT i, avg(eight[i]) avg_v FROM latest, generate_series(1, 8) i GROUP BY i) a)
    )
  );
END;
$$;

-- ----------------------------------------------------------------
-- 권한: CREATE FUNCTION 기본값이 PUBLIC EXECUTE 라 PUBLIC 까지 회수한다 (CLAUDE.md)
-- ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fun_quiz_score(smallint[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fun_quiz_result_json(public.fun_quiz_responses) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fun_quiz_submit(smallint[], boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_quiz_get_result(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_quiz_my_results() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fun_quiz_admin_stats(timestamptz, timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fun_quiz_submit(smallint[], boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_quiz_get_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_quiz_my_results() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_quiz_admin_stats(timestamptz, timestamptz) TO authenticated;
