-- ================================================================
-- MIGRATION: fun_worldcup_undo
-- 날짜: 2026-09-29
-- 배경: 대결 화면 「↶ 방금 선택 되돌리기」 (spec §3-4 변경 — 직전 한 단계).
--   서버 기록 = 화면이 마지막으로 보낸 선택 목록. 목록과 다른 기록은 덮어쓰고, 목록 뒤쪽 기록은 지운다.
--   지우거나 덮어쓴 선택은 fun_worldcup_undos 에 남긴다 (첫 선택을 바꾼 데이터 분석용).
--   요청 순번(p_seq, 화면이 보낸 시각 ms)이 더 오래된 요청은 무시 → 늦게 도착한 요청이 되돌린 선택을 살리지 못한다.
--   fun_wc_record / fun_wc_finish 에 p_seq 추가 → 옛 시그니처 DROP (p_seq 없는 옛 화면 요청도 그대로 받아짐)
-- ================================================================

ALTER TABLE public.fun_worldcup_runs ADD COLUMN last_seq bigint;

CREATE TABLE public.fun_worldcup_undos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          uuid NOT NULL REFERENCES public.fun_worldcup_runs(id) ON DELETE CASCADE,
  round_size      integer NOT NULL,
  match_no        integer NOT NULL,
  top_game_id     integer NOT NULL,
  bottom_game_id  integer NOT NULL,
  winner_game_id  integer NOT NULL,   -- 되돌려진(바뀌기 전) 선택
  undone_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fun_worldcup_undos_run_idx ON public.fun_worldcup_undos (run_id);
ALTER TABLE public.fun_worldcup_undos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fun_worldcup_undos FROM PUBLIC, anon, authenticated;

-- 선택 목록을 서버 기록에 맞춘다: 같으면 그대로, 다르면 덮어쓰기(되돌림 기록), 목록 뒤쪽은 지우기(되돌림 기록)
CREATE OR REPLACE FUNCTION public._fun_wc_apply_picks(p_run public.fun_worldcup_runs, p_picks jsonb)
RETURNS integer[]
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_real   integer := (SELECT count(*) FROM unnest(p_run.bracket) x WHERE x IS NOT NULL) - 1;
  v_n      integer;
  v_cur    integer[] := p_run.bracket;
  v_next   integer[];
  v_len    integer;
  v_pair   integer := 0;
  v_idx    integer := 0;
  v_pick   jsonb;
  v_a      integer;
  v_b      integer;
  v_w      integer;
  v_top    integer;
  v_bottom integer;
  v_ms     integer;
  v_u      jsonb;
  v_old    public.fun_worldcup_matches%ROWTYPE;
  v_slots  text[] := '{}';
BEGIN
  IF jsonb_typeof(p_picks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_picks) > v_real THEN
    RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
  END IF;
  v_n := jsonb_array_length(p_picks);

  WHILE cardinality(v_cur) > 1 LOOP
    v_len := cardinality(v_cur);
    v_next := '{}';
    FOR i IN 1 .. v_len / 2 LOOP
      v_a := v_cur[2 * i - 1];
      v_b := v_cur[2 * i];

      IF v_a IS NULL OR v_b IS NULL THEN
        v_next := array_append(v_next, COALESCE(v_a, v_b));
        v_pair := v_pair + 1;
        CONTINUE;
      END IF;

      EXIT WHEN v_idx >= v_n;
      v_pick := p_picks -> v_idx;

      IF jsonb_typeof(v_pick->'w') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
      END IF;
      v_w := (v_pick->>'w')::integer;
      IF v_w IS DISTINCT FROM v_a AND v_w IS DISTINCT FROM v_b THEN
        RAISE EXCEPTION '선택 기록이 대진과 맞지 않습니다.';
      END IF;

      IF p_run.top_first[v_pair + 1] THEN
        v_top := v_a; v_bottom := v_b;
      ELSE
        v_top := v_b; v_bottom := v_a;
      END IF;

      v_ms := CASE WHEN jsonb_typeof(v_pick->'ms') = 'number'
                   THEN LEAST(GREATEST((v_pick->>'ms')::numeric, 0), 600000)::integer END;
      v_u := CASE WHEN jsonb_typeof(v_pick->'u') = 'array' THEN v_pick->'u' ELSE '[]'::jsonb END;

      SELECT * INTO v_old FROM public.fun_worldcup_matches
      WHERE run_id = p_run.id AND round_size = v_len AND match_no = i;

      IF NOT FOUND THEN
        INSERT INTO public.fun_worldcup_matches
          (run_id, round_size, match_no, top_game_id, bottom_game_id, winner_game_id, picked_top, decide_ms,
           top_unplayed, bottom_unplayed)
        VALUES (p_run.id, v_len, i, v_top, v_bottom, v_w, v_w = v_top, v_ms,
                v_u @> jsonb_build_array(v_top), v_u @> jsonb_build_array(v_bottom));
      ELSIF v_old.top_game_id <> v_top OR v_old.bottom_game_id <> v_bottom OR v_old.winner_game_id <> v_w THEN
        -- 되돌린 뒤 다르게 고름 (또는 앞선 선택이 바뀌어 대진이 달라짐): 옛 선택은 되돌림 기록으로
        INSERT INTO public.fun_worldcup_undos (run_id, round_size, match_no, top_game_id, bottom_game_id, winner_game_id)
        VALUES (p_run.id, v_len, i, v_old.top_game_id, v_old.bottom_game_id, v_old.winner_game_id);
        UPDATE public.fun_worldcup_matches
        SET top_game_id = v_top, bottom_game_id = v_bottom, winner_game_id = v_w, picked_top = v_w = v_top,
            decide_ms = v_ms, top_unplayed = v_u @> jsonb_build_array(v_top),
            bottom_unplayed = v_u @> jsonb_build_array(v_bottom), created_at = now()
        WHERE run_id = p_run.id AND round_size = v_len AND match_no = i;
      END IF;

      v_slots := array_append(v_slots, v_len || ':' || i);
      v_next := array_append(v_next, v_w);
      v_pair := v_pair + 1;
      v_idx := v_idx + 1;
    END LOOP;

    EXIT WHEN cardinality(v_next) < v_len / 2;
    v_cur := v_next;
  END LOOP;

  -- 목록에 없는 기록 = 되돌린 선택: 지우고 되돌림 기록으로
  WITH gone AS (
    DELETE FROM public.fun_worldcup_matches
    WHERE run_id = p_run.id AND NOT ((round_size || ':' || match_no) = ANY (v_slots))
    RETURNING run_id, round_size, match_no, top_game_id, bottom_game_id, winner_game_id
  )
  INSERT INTO public.fun_worldcup_undos (run_id, round_size, match_no, top_game_id, bottom_game_id, winner_game_id)
  SELECT * FROM gone;

  RETURN v_cur;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._fun_wc_apply_picks(public.fun_worldcup_runs, jsonb) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.fun_wc_record(uuid, jsonb, uuid);
CREATE FUNCTION public.fun_wc_record(p_run_id uuid, p_picks jsonb, p_anon_id uuid DEFAULT NULL, p_seq bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run public.fun_worldcup_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.fun_worldcup_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '판을 찾을 수 없습니다.'; END IF;

  IF NOT ((v_uid IS NOT NULL AND v_run.user_id = v_uid)
       OR (p_anon_id IS NOT NULL AND v_run.anon_id = p_anon_id)) THEN
    RAISE EXCEPTION '이 판을 제출할 권한이 없습니다.';
  END IF;

  IF v_run.status <> 'started' THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_run.status);
  END IF;

  -- 늦게 도착한 옛 요청은 무시 (되돌린 선택이 되살아나지 않게)
  IF p_seq IS NOT NULL AND v_run.last_seq IS NOT NULL AND p_seq < v_run.last_seq THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  PERFORM public._fun_wc_apply_picks(v_run, p_picks);
  IF p_seq IS NOT NULL THEN
    UPDATE public.fun_worldcup_runs SET last_seq = p_seq WHERE id = v_run.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'recorded', jsonb_array_length(p_picks));
END;
$$;

DROP FUNCTION public.fun_wc_finish(uuid, jsonb, uuid);
CREATE FUNCTION public.fun_wc_finish(p_run_id uuid, p_picks jsonb, p_anon_id uuid DEFAULT NULL, p_seq bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_run   public.fun_worldcup_runs%ROWTYPE;
  v_final integer[];
BEGIN
  SELECT * INTO v_run FROM public.fun_worldcup_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '판을 찾을 수 없습니다.'; END IF;

  IF NOT ((v_uid IS NOT NULL AND v_run.user_id = v_uid)
       OR (p_anon_id IS NOT NULL AND v_run.anon_id = p_anon_id)) THEN
    RAISE EXCEPTION '이 판을 제출할 권한이 없습니다.';
  END IF;

  IF v_run.status <> 'started' THEN RAISE EXCEPTION '이미 끝난 판입니다.'; END IF;

  IF jsonb_typeof(p_picks) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_picks) <> (SELECT count(*) FROM unnest(v_run.bracket) x WHERE x IS NOT NULL) - 1 THEN
    RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
  END IF;

  -- 제출은 전체 선택이 담긴 마지막 요청이다. 순번이 있으면 기록만 갱신 (제출 자체는 막지 않음)
  v_final := public._fun_wc_apply_picks(v_run, p_picks);
  IF cardinality(v_final) <> 1 OR v_final[1] IS NULL THEN
    RAISE EXCEPTION '선택 기록이 올바르지 않습니다.';
  END IF;

  UPDATE public.fun_worldcup_runs
  SET status = 'finished', champion_game_id = v_final[1], finished_at = now(),
      last_seq = GREATEST(COALESCE(last_seq, 0), COALESCE(p_seq, 0))
  WHERE id = v_run.id;

  RETURN public.fun_wc_get_run(v_run.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fun_wc_record(uuid, jsonb, uuid, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fun_wc_finish(uuid, jsonb, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fun_wc_record(uuid, jsonb, uuid, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_finish(uuid, jsonb, uuid, bigint) TO anon, authenticated;
