-- ================================================================
-- MIGRATION: fun_quiz_score_scale
-- 날짜: 2026-10-01
-- 배경: fun_quiz_score() 가 8축 점수를 −1~+1 로 맞출 때 응답 범위(±2)를 나누지 않아 −2~+2 가 나왔다.
--   그 결과 코드 기준(±0.25)이 사실상 절반으로 느슨해지고 결과 막대가 범위를 벗어났다.
--   s / t → s / (2 * t) 로 고치고, 이미 저장된 응답을 같은 응답으로 다시 채점한다(파생 값만 갱신).
-- ================================================================

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
    eight := eight || CASE WHEN t = 0 THEN 0 ELSE s / (2 * t) END;  -- 응답이 ±2 라 2로 나눈다 → −1~+1
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

REVOKE EXECUTE ON FUNCTION public.fun_quiz_score(smallint[]) FROM PUBLIC, anon, authenticated;

-- 이미 저장된 응답 다시 채점 (answers 는 그대로, 파생 값만)
UPDATE public.fun_quiz_responses r
SET eight = ARRAY(SELECT x::numeric FROM jsonb_array_elements_text(s.v->'eight') x),
    four  = ARRAY(SELECT x::numeric FROM jsonb_array_elements_text(s.v->'four') x),
    code  = s.v->>'code'
FROM (SELECT id, public.fun_quiz_score(answers) v FROM public.fun_quiz_responses) s
WHERE s.id = r.id;
