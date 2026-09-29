-- ================================================================
-- MIGRATION: game_info_reports_and_wc_insights
-- 날짜: 2026-09-29
-- 배경:
--   1) 게임 정보 오류 신고 (인원수·플레이 시간·이미지·이름 등). 월드컵 카드에서 먼저 쓰고,
--      게임 상세 등 다른 화면에서도 쓸 수 있게 공용으로 둔다. 비회원도 신고 가능 → SECURITY DEFINER RPC 로만 쓴다.
--      damage_reports(실물 파손, 회원 전용)와는 성격이 달라 별도 테이블.
--   2) 이상형 월드컵 「안 해봄」 통계 (spec_fun_worldcup.md §6-1).
--      칩을 한 번이라도 누른 판(= 칩을 아는 사람)만 대상으로, 그 판에서 표시 없는 게임은 "해봤음(추정)".
--
-- 새 anon 실행 함수: report_game_info (쓰기, 기기당 1시간 10건), fun_wc_insights (읽기, 집계만)
-- ================================================================

CREATE TABLE public.game_info_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      integer REFERENCES public.games(id) ON DELETE SET NULL,
  game_name    text NOT NULL,                     -- 신고 당시 이름 (게임이 지워져도 남도록)
  field        text NOT NULL CHECK (field IN ('players', 'playtime', 'image', 'name', 'other')),
  shown_value  text CHECK (char_length(shown_value) <= 100),   -- 신고 당시 화면에 보인 값 (예: "2~15인")
  note         text CHECK (char_length(note) <= 200),
  source       text NOT NULL DEFAULT 'worldcup' CHECK (source IN ('worldcup', 'game_detail', 'other')),
  user_id      uuid,
  anon_id      uuid,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid,
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);

CREATE INDEX game_info_reports_status_idx ON public.game_info_reports (status, created_at DESC);
CREATE INDEX game_info_reports_reporter_idx ON public.game_info_reports (anon_id, created_at) WHERE anon_id IS NOT NULL;

ALTER TABLE public.game_info_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_info_reports FROM PUBLIC, anon, authenticated;

-- ── 신고 (비회원 가능) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_game_info(
  p_game_id integer,
  p_field text,
  p_note text DEFAULT NULL,
  p_shown_value text DEFAULT NULL,
  p_source text DEFAULT 'worldcup',
  p_anon_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_name   text;
  v_note   text := NULLIF(btrim(p_note), '');
  v_recent integer;
BEGIN
  IF v_uid IS NULL AND p_anon_id IS NULL THEN RAISE EXCEPTION '기기 식별자가 필요합니다.'; END IF;
  IF p_field NOT IN ('players', 'playtime', 'image', 'name', 'other') THEN RAISE EXCEPTION '신고 항목이 올바르지 않습니다.'; END IF;
  IF p_source NOT IN ('worldcup', 'game_detail', 'other') THEN RAISE EXCEPTION '신고 위치가 올바르지 않습니다.'; END IF;
  IF char_length(v_note) > 200 THEN RAISE EXCEPTION '메모는 200자까지 쓸 수 있어요.'; END IF;
  IF p_field = 'other' AND v_note IS NULL THEN RAISE EXCEPTION '기타는 어떤 점이 이상한지 적어 주세요.'; END IF;

  SELECT name INTO v_name FROM public.games WHERE id = p_game_id;
  IF NOT FOUND THEN RAISE EXCEPTION '게임을 찾을 수 없습니다.'; END IF;

  SELECT count(*) INTO v_recent
  FROM public.game_info_reports
  WHERE created_at > now() - interval '1 hour'
    AND ((v_uid IS NOT NULL AND user_id = v_uid) OR (p_anon_id IS NOT NULL AND anon_id = p_anon_id));
  IF v_recent >= 10 THEN RAISE EXCEPTION '신고가 너무 많아요. 잠시 후 다시 해 주세요.'; END IF;

  -- 같은 사람이 같은 게임·항목을 하루 안에 다시 신고하면 새로 쌓지 않는다
  IF EXISTS (
    SELECT 1 FROM public.game_info_reports
    WHERE game_id = p_game_id AND field = p_field AND status = 'pending'
      AND created_at > now() - interval '1 day'
      AND ((v_uid IS NOT NULL AND user_id = v_uid) OR (p_anon_id IS NOT NULL AND anon_id = p_anon_id))
  ) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  INSERT INTO public.game_info_reports (game_id, game_name, field, shown_value, note, source, user_id, anon_id)
  VALUES (p_game_id, v_name, p_field, left(NULLIF(btrim(p_shown_value), ''), 100), v_note, p_source, v_uid,
          CASE WHEN v_uid IS NULL THEN p_anon_id END);

  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END;
$$;

-- ── 관리자: 신고 목록·처리 (화면은 P5) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_game_info_reports(p_status text DEFAULT 'pending', p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_limit < 1 OR p_limit > 500 THEN RAISE EXCEPTION 'p_limit는 1~500 범위여야 합니다.'; END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', r.id, 'game_id', r.game_id, 'game_name', COALESCE(g.name, r.game_name),
             'field', r.field, 'shown_value', r.shown_value, 'note', r.note, 'source', r.source,
             'is_member', r.user_id IS NOT NULL, 'reporter_name', p.name,
             'status', r.status, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
             'current', jsonb_build_object('min_players', g.min_players, 'max_players', g.max_players,
                                           'playingtime', g.playingtime, 'image', g.image)
           ) ORDER BY r.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT * FROM public.game_info_reports
      WHERE p_status IS NULL OR status = p_status
      ORDER BY created_at DESC
      LIMIT p_limit
    ) r
    LEFT JOIN public.games g ON g.id = r.game_id
    LEFT JOIN public.profiles p ON p.id = r.user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_game_info_report_status(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_status NOT IN ('pending', 'resolved', 'dismissed') THEN RAISE EXCEPTION '상태가 올바르지 않습니다.'; END IF;

  UPDATE public.game_info_reports
  SET status = p_status,
      resolved_at = CASE WHEN p_status = 'pending' THEN NULL ELSE now() END,
      resolved_by = CASE WHEN p_status = 'pending' THEN NULL ELSE auth.uid() END
  WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION '신고를 찾을 수 없습니다.'; END IF;
END;
$$;

-- ── 월드컵 「안 해봄」 통계 ────────────────────────────────────────
-- 대상 판: 칩을 한 번이라도 누른 판 (상태 무관 — 이탈 판의 대결도 포함), 범위·tester 제외는 다른 통계와 같다.
--   familiarity      = 1 - (안 해봄으로 표시된 판 수 / 등장한 판 수)        — 동아리에서 해본 사람 비율
--   curiosity_rate   = 안 해본 채로 이긴 대결 / 안 해본 채로 치른 대결      — 첫인상(박스·이름)으로 끌리는 정도
--   experienced_rate = 해봤음(추정) 상태의 승률                             — 해본 사람이 실제로 좋아하는 정도
-- 표본(판 수·대결 수)이 p_min 미만인 지표는 null 로 둔다 (판단 보류).
-- signal: curious(끌림) · classic(검증된 명작) · first_impression(첫인상 대비 실제 만족 낮음) — spec §6-1 기준
CREATE OR REPLACE FUNCTION public.fun_wc_insights(p_slug text, p_scope text DEFAULT 'all', p_min integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_theme public.fun_worldcup_themes%ROWTYPE;
BEGIN
  IF p_scope NOT IN ('member', 'all') THEN RAISE EXCEPTION '집계 범위가 올바르지 않습니다.'; END IF;
  IF p_min IS NULL OR p_min < 1 OR p_min > 100 THEN RAISE EXCEPTION 'p_min 범위가 올바르지 않습니다.'; END IF;

  SELECT * INTO v_theme FROM public.fun_worldcup_themes WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '월드컵을 찾을 수 없습니다.'; END IF;

  RETURN (
    WITH runs AS (
      SELECT r.id
      FROM public.fun_worldcup_runs r
      WHERE r.theme_id = v_theme.id
        AND (p_scope = 'all' OR r.is_member)
        AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = r.user_id AND ur.role_key = 'tester')
        AND EXISTS (SELECT 1 FROM public.fun_worldcup_matches m
                    WHERE m.run_id = r.id AND (m.top_unplayed OR m.bottom_unplayed))
    ),
    sides AS (
      SELECT m.run_id, m.top_game_id AS gid, m.winner_game_id = m.top_game_id AS won, m.top_unplayed AS unplayed
      FROM public.fun_worldcup_matches m JOIN runs ON runs.id = m.run_id
      UNION ALL
      SELECT m.run_id, m.bottom_game_id, m.winner_game_id = m.bottom_game_id, m.bottom_unplayed
      FROM public.fun_worldcup_matches m JOIN runs ON runs.id = m.run_id
    ),
    per_run AS (  -- 한 판 안에서 한 번이라도 「안 해봄」이면 그 판에서는 안 해본 게임
      SELECT gid, run_id, bool_or(unplayed) AS unplayed FROM sides GROUP BY gid, run_id
    ),
    g AS (
      SELECT s.gid,
             (SELECT count(*) FROM per_run p WHERE p.gid = s.gid) AS seen_runs,
             (SELECT count(*) FROM per_run p WHERE p.gid = s.gid AND p.unplayed) AS unplayed_runs,
             count(*) FILTER (WHERE s.unplayed AND s.won) AS u_wins,
             count(*) FILTER (WHERE s.unplayed AND NOT s.won) AS u_losses,
             count(*) FILTER (WHERE NOT s.unplayed AND s.won) AS p_wins,
             count(*) FILTER (WHERE NOT s.unplayed AND NOT s.won) AS p_losses
      FROM sides s GROUP BY s.gid
    ),
    m AS (
      SELECT g.*,
             CASE WHEN seen_runs >= p_min THEN round(1 - unplayed_runs::numeric / seen_runs, 4) END AS familiarity,
             CASE WHEN u_wins + u_losses >= p_min THEN round(u_wins::numeric / (u_wins + u_losses), 4) END AS curiosity_rate,
             CASE WHEN p_wins + p_losses >= p_min THEN round(p_wins::numeric / (p_wins + p_losses), 4) END AS experienced_rate
      FROM g
    )
    SELECT jsonb_build_object(
      'slug', v_theme.slug,
      'scope', p_scope,
      'min_sample', p_min,
      'marking_runs', (SELECT count(*) FROM runs),
      'items', COALESCE(jsonb_agg(jsonb_build_object(
        'id', m.gid, 'name', gm.name, 'image', gm.image,
        'seen_runs', m.seen_runs, 'unplayed_runs', m.unplayed_runs,
        'unplayed_wins', m.u_wins, 'unplayed_losses', m.u_losses,
        'played_wins', m.p_wins, 'played_losses', m.p_losses,
        'familiarity', m.familiarity,
        'curiosity_rate', m.curiosity_rate,
        'experienced_rate', m.experienced_rate,
        'signal', CASE
          WHEN m.curiosity_rate >= 0.6 AND m.experienced_rate < 0.4 THEN 'first_impression'
          WHEN m.experienced_rate >= 0.6 AND m.familiarity >= 0.6 THEN 'classic'
          WHEN m.curiosity_rate >= 0.6 THEN 'curious'
        END
      ) ORDER BY m.curiosity_rate DESC NULLS LAST, m.u_wins DESC), '[]'::jsonb)
    )
    FROM m JOIN public.games gm ON gm.id = m.gid
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_game_info(integer, text, text, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fun_wc_insights(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_game_info_reports(text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_game_info_report_status(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.report_game_info(integer, text, text, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fun_wc_insights(text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_game_info_reports(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_game_info_report_status(uuid, text) TO authenticated;
