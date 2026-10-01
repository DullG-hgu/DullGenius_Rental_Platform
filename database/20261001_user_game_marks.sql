-- ================================================================
-- MIGRATION: user_game_marks
-- 날짜: 2026-10-01
-- 배경: 월드컵 「안 해봄」 표시를 판 밖에서도 유지하는 회원별 상태로 모은다.
--   - 다음 판에서 「안 해봄」이 미리 켜진다 (fun_wc_my_prefill). 미리 켜진 걸 끄면 = 해봤음 (picks 의 p 배열)
--   - 본인이 대여(RENT)한 기록이 표시보다 나중이면 해봤음으로 본다 (_fun_my_game_status, 읽을 때 계산)
--   - 1차는 수집만. 화면(상세 한 줄·마이페이지 목록)·해본 게임 전용 월드컵은 후속
--   - 기존 「안 해봄」 통계(fun_wc_insights)는 건드리지 않는다. 단 이날부터 미리 켜짐 때문에 표시율 기준이 바뀐다
--
-- 접근 원칙: 테이블은 RLS 켬 + 정책 없음 + 직접 권한 없음. RPC 로만.
-- ================================================================

-- 현재 상태 (회원 × 게임 한 줄)
CREATE TABLE IF NOT EXISTS public.user_game_marks (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id     int4 NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('unplayed', 'played')),
  source      text NOT NULL CHECK (source IN ('worldcup', 'manual', 'backfill')),
  run_id      uuid,  -- 마지막으로 바꾼 월드컵 판
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

-- 변경 이력 (분석용: 언제 안 해봄 → 해봤음으로 바뀌었나)
CREATE TABLE IF NOT EXISTS public.user_game_mark_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id     int4 NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  status      text NOT NULL,
  source      text NOT NULL,
  run_id      uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_game_mark_events_user_idx ON public.user_game_mark_events (user_id, game_id);
CREATE INDEX IF NOT EXISTS user_game_mark_events_game_idx ON public.user_game_mark_events (game_id);

ALTER TABLE public.user_game_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_game_mark_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_game_marks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_game_mark_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._user_game_marks_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.user_game_mark_events (user_id, game_id, status, source, run_id, created_at)
    VALUES (NEW.user_id, NEW.game_id, NEW.status, NEW.source, NEW.run_id, NEW.updated_at);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._user_game_marks_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_game_marks_log ON public.user_game_marks;
CREATE TRIGGER user_game_marks_log
AFTER INSERT OR UPDATE ON public.user_game_marks
FOR EACH ROW EXECUTE FUNCTION public._user_game_marks_log();

-- 회원 한 명의 게임별 실효 상태: 직접 표시 + 대여 기록(표시보다 나중이면 해봤음, 표시 없는 대여도 해봤음)
-- 해본 게임 전용 월드컵·상세 한 줄·마이페이지 목록이 모두 이 함수 하나를 기준으로 쓴다
CREATE OR REPLACE FUNCTION public._fun_my_game_status(p_uid uuid)
RETURNS TABLE(game_id integer, status text, source text, at timestamptz)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH m AS (
    SELECT * FROM public.user_game_marks WHERE user_id = p_uid
  ), rent AS (
    SELECT r.game_id, max(r.borrowed_at) AS at
    FROM public.rentals r
    WHERE r.user_id = p_uid AND r.type = 'RENT' AND r.borrowed_at IS NOT NULL
    GROUP BY r.game_id
  )
  SELECT COALESCE(m.game_id, rent.game_id),
         CASE WHEN m.game_id IS NULL OR rent.at > m.updated_at THEN 'played' ELSE m.status END,
         CASE WHEN m.game_id IS NULL OR rent.at > m.updated_at THEN 'rental' ELSE m.source END,
         CASE WHEN m.game_id IS NULL OR rent.at > m.updated_at THEN rent.at ELSE m.updated_at END
  FROM m FULL JOIN rent ON rent.game_id = m.game_id
$$;
REVOKE EXECUTE ON FUNCTION public._fun_my_game_status(uuid) FROM PUBLIC, anon, authenticated;

-- [Member] 이 판 후보 중 내가 아직 안 해본 게임 id 목록 → 「안 해봄」 미리 켜기. 남의 판·비회원이면 []
CREATE OR REPLACE FUNCTION public.fun_wc_my_prefill(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_bracket integer[];
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT bracket INTO v_bracket FROM public.fun_worldcup_runs WHERE id = p_run_id AND user_id = v_uid;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(s.game_id ORDER BY s.game_id), '[]'::jsonb)
    FROM public._fun_my_game_status(v_uid) s
    WHERE s.status = 'unplayed' AND s.game_id = ANY (v_bracket)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fun_wc_my_prefill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fun_wc_my_prefill(uuid) TO authenticated;

-- 대결 기록 적용: 끝에 회원별 표시 반영 블록 추가 (나머지는 그대로)
CREATE OR REPLACE FUNCTION public._fun_wc_apply_picks(p_run fun_worldcup_runs, p_picks jsonb)
 RETURNS integer[]
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  WITH gone AS (
    DELETE FROM public.fun_worldcup_matches
    WHERE run_id = p_run.id AND NOT ((round_size || ':' || match_no) = ANY (v_slots))
    RETURNING run_id, round_size, match_no, top_game_id, bottom_game_id, winner_game_id
  )
  INSERT INTO public.fun_worldcup_undos (run_id, round_size, match_no, top_game_id, bottom_game_id, winner_game_id)
  SELECT * FROM gone;

  -- 회원 판: 「안 해봄」(u) · 미리 켜진 표시를 끈 게임(p = 해봤음)을 회원별 표시(user_game_marks)에 반영.
  -- 같은 게임이 여러 대결에 나오면 마지막 대결 기준. 진행분 전체를 매번 다시 보내므로,
  -- 이 판이 시작된 뒤 다른 경로(직접 변경 등)로 바뀐 표시는 덮어쓰지 않는다.
  IF p_run.user_id IS NOT NULL THEN
    INSERT INTO public.user_game_marks AS um (user_id, game_id, status, source, run_id)
    SELECT DISTINCT ON (e.gid) p_run.user_id, e.gid, e.st, 'worldcup', p_run.id
    FROM (
      SELECT a.ord, (x.v)::numeric AS gid_n, k.st
      FROM jsonb_array_elements(p_picks) WITH ORDINALITY AS a(pk, ord)
      CROSS JOIN (VALUES ('u', 'unplayed'), ('p', 'played')) AS k(key, st)
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(a.pk -> k.key) = 'array' THEN a.pk -> k.key ELSE '[]'::jsonb END) AS x(v)
      WHERE jsonb_typeof(x.v) = 'number'
    ) e0
    CROSS JOIN LATERAL (SELECT e0.ord, e0.st, b.id AS gid
                        FROM unnest(p_run.bracket) AS b(id) WHERE b.id = e0.gid_n) e
    ORDER BY e.gid, e.ord DESC, e.st DESC
    ON CONFLICT (user_id, game_id) DO UPDATE
      SET status = EXCLUDED.status, source = 'worldcup', run_id = EXCLUDED.run_id, updated_at = now()
      WHERE um.status <> EXCLUDED.status
        AND (um.run_id = p_run.id OR um.updated_at < p_run.started_at);
  END IF;

  RETURN v_cur;
END;
$function$;

-- 백필: 지금까지 회원 판에서 「안 해봄」 표시한 게임 (같은 게임은 가장 최근 표시 시각)
INSERT INTO public.user_game_marks (user_id, game_id, status, source, run_id, created_at, updated_at)
SELECT DISTINCT ON (r.user_id, s.gid) r.user_id, s.gid, 'unplayed', 'backfill', r.id, s.at, s.at
FROM public.fun_worldcup_runs r
CROSS JOIN LATERAL (
  SELECT m.top_game_id AS gid, m.created_at AS at
  FROM public.fun_worldcup_matches m WHERE m.run_id = r.id AND m.top_unplayed
  UNION ALL
  SELECT m.bottom_game_id, m.created_at
  FROM public.fun_worldcup_matches m WHERE m.run_id = r.id AND m.bottom_unplayed
) s
WHERE r.user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id)
  AND EXISTS (SELECT 1 FROM public.games g WHERE g.id = s.gid)
ORDER BY r.user_id, s.gid, s.at DESC
ON CONFLICT (user_id, game_id) DO NOTHING;
