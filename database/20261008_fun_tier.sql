-- ================================================================
-- 놀이 콘텐츠 3탄 — 머더미스터리 티어표 (spec_fun_tier.md)
-- 2026-10-08
--
-- 원칙: 테이블은 RLS 켜고 정책·GRANT 없음. 읽기·쓰기는 SECURITY DEFINER RPC 로만.
-- 「안 해봄/해봤음」은 기존 user_game_marks 에 source='tier' 로 남긴다 (판정은 _fun_my_game_status 한 곳).
-- ================================================================

-- ── 테이블 ───────────────────────────────────────────────────────

CREATE TABLE public.fun_tier_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{1,40}$'),
  title       text NOT NULL,
  description text,
  filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_sample  integer NOT NULL DEFAULT 3 CHECK (min_sample BETWEEN 1 AND 50),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 회원별 표 머리 — 티어 이름(별명)·공개 여부. started_at = 「전부 안 해봄」 기준선을 처음 깐 시각
CREATE TABLE public.fun_tier_lists (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.fun_tier_templates(id) ON DELETE CASCADE,
  labels      text[] NOT NULL DEFAULT ARRAY['', '', '', '', '']::text[],
  is_public   boolean NOT NULL DEFAULT false,
  started_at  timestamptz,
  last_seq    bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, template_id),
  CHECK (cardinality(labels) = 5
     AND char_length(labels[1]) <= 10 AND char_length(labels[2]) <= 10 AND char_length(labels[3]) <= 10
     AND char_length(labels[4]) <= 10 AND char_length(labels[5]) <= 10)
);

-- 배치 — 행이 없으면 「안 해봄」 줄. pos 는 줄 안 순서(본인 표 전용, 집계에 안 씀)
CREATE TABLE public.fun_tier_placements (
  user_id     uuid NOT NULL,
  template_id uuid NOT NULL,
  game_id     integer NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  tier        char(1) NOT NULL CHECK (tier IN ('S', 'A', 'B', 'C', 'D')),
  pos         smallint NOT NULL DEFAULT 0 CHECK (pos BETWEEN 0 AND 999),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, template_id, game_id),
  FOREIGN KEY (user_id, template_id) REFERENCES public.fun_tier_lists(user_id, template_id) ON DELETE CASCADE
);

CREATE INDEX fun_tier_placements_template_game_idx ON public.fun_tier_placements (template_id, game_id);

ALTER TABLE public.fun_tier_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fun_tier_lists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fun_tier_placements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fun_tier_templates, public.fun_tier_lists, public.fun_tier_placements FROM PUBLIC, anon, authenticated;

-- user_game_marks 에 출처 'tier' 추가
ALTER TABLE public.user_game_marks DROP CONSTRAINT user_game_marks_source_check;
ALTER TABLE public.user_game_marks ADD CONSTRAINT user_game_marks_source_check
  CHECK (source = ANY (ARRAY['worldcup'::text, 'manual'::text, 'backfill'::text, 'tier'::text]));

INSERT INTO public.fun_tier_templates (slug, title, description, filter, min_sample, sort_order)
VALUES ('murder', '머더미스터리 티어표', '해본 머더에 등급 매기고 모두의 티어 보기',
        '{"category": "머더미스터리"}'::jsonb, 3, 0);

-- ── 내부 함수 ────────────────────────────────────────────────────

-- 템플릿 후보: 필터 카테고리 + 확장판 제외. 대여 가능·이미지 유무로 거르지 않는다 (분실작도 평가 가능)
CREATE OR REPLACE FUNCTION public._fun_tier_pool(p_filter jsonb)
 RETURNS TABLE(id integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT g.id FROM public.games g
  WHERE g.base_game_id IS NULL
    AND (p_filter ->> 'category' IS NULL OR g.category = p_filter ->> 'category')
$function$;

-- 내 표 (fun_tier_my·fun_tier_save 공용)
CREATE OR REPLACE FUNCTION public._fun_tier_my_json(p_uid uuid, p_template public.fun_tier_templates)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'slug', p_template.slug,
    'started', l.started_at IS NOT NULL,
    'started_at', l.started_at,
    'is_public', COALESCE(l.is_public, false),
    'labels', to_jsonb(COALESCE(l.labels, ARRAY['', '', '', '', '']::text[])),
    'updated_at', l.updated_at,
    'last_seq', l.last_seq,
    'placements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('game_id', p.game_id, 'tier', p.tier, 'pos', p.pos)
                       ORDER BY p.tier, p.pos, p.game_id)
      FROM public.fun_tier_placements p
      JOIN public._fun_tier_pool(p_template.filter) pool ON pool.id = p.game_id
      WHERE p.user_id = p_uid AND p.template_id = p_template.id
    ), '[]'::jsonb),
    -- 트레이에 있지만 대여·월드컵 기록으로는 해본 게임 → 화면에 「대여 기록 있음」
    'played_elsewhere', COALESCE((
      SELECT jsonb_agg(s.game_id ORDER BY s.game_id)
      FROM public._fun_my_game_status(p_uid) s
      JOIN public._fun_tier_pool(p_template.filter) pool ON pool.id = s.game_id
      WHERE s.status = 'played' AND s.source <> 'tier'
        AND NOT EXISTS (SELECT 1 FROM public.fun_tier_placements p
                        WHERE p.user_id = p_uid AND p.template_id = p_template.id AND p.game_id = s.game_id)
    ), '[]'::jsonb)
  )
  FROM (SELECT 1) one
  LEFT JOIN public.fun_tier_lists l ON l.user_id = p_uid AND l.template_id = p_template.id
$function$;

REVOKE ALL ON FUNCTION public._fun_tier_pool(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fun_tier_my_json(uuid, public.fun_tier_templates) FROM PUBLIC, anon, authenticated;

-- ── 공개 RPC ─────────────────────────────────────────────────────

-- 템플릿 + 후보 게임 (비회원도)
CREATE OR REPLACE FUNCTION public.fun_tier_get_template(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.fun_tier_templates%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;
  RETURN jsonb_build_object(
    'slug', v_t.slug, 'title', v_t.title, 'description', v_t.description, 'min_sample', v_t.min_sample,
    'games', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', g.id, 'name', g.name, 'image', g.image,
               'min_players', g.min_players, 'max_players', g.max_players, 'playingtime', g.playingtime)
             ORDER BY g.name)
      FROM public._fun_tier_pool(v_t.filter) pool JOIN public.games g ON g.id = pool.id
    ), '[]'::jsonb)
  );
END;
$function$;

-- 내 표
CREATE OR REPLACE FUNCTION public.fun_tier_my(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_t   public.fun_tier_templates%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;
  RETURN public._fun_tier_my_json(v_uid, v_t);
END;
$function$;

-- 표 전체 저장. p_placements = [{"g":게임id,"t":"S","p":줄 안 순서}, ...] (전체 교체)
-- p_labels = 티어 이름 5개 (NULL 이면 그대로). p_seq = 클라이언트 시각 — 늦게 도착한 옛 요청은 무시
CREATE OR REPLACE FUNCTION public.fun_tier_save(p_slug text, p_placements jsonb, p_labels text[] DEFAULT NULL, p_seq bigint DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_t       public.fun_tier_templates%ROWTYPE;
  v_list    public.fun_tier_lists%ROWTYPE;
  v_gids    integer[];
  v_tiers   text[];
  v_pos     integer[];
  v_labels  text[];
  v_removed integer[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;

  IF jsonb_typeof(p_placements) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '배치 형식이 올바르지 않습니다.'; END IF;
  IF jsonb_array_length(p_placements) > 500 THEN RAISE EXCEPTION '배치가 너무 많습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_placements) e
             WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
                OR jsonb_typeof(e -> 'g') IS DISTINCT FROM 'number'
                OR jsonb_typeof(e -> 'p') IS DISTINCT FROM 'number'
                OR (e ->> 't') IS NULL
                OR (e ->> 't') NOT IN ('S', 'A', 'B', 'C', 'D')) THEN
    RAISE EXCEPTION '배치 형식이 올바르지 않습니다.';
  END IF;

  SELECT array_agg((e ->> 'g')::integer ORDER BY o), array_agg(e ->> 't' ORDER BY o), array_agg((e ->> 'p')::integer ORDER BY o)
  INTO v_gids, v_tiers, v_pos
  FROM jsonb_array_elements(p_placements) WITH ORDINALITY AS a(e, o);
  v_gids := COALESCE(v_gids, '{}'); v_tiers := COALESCE(v_tiers, '{}'); v_pos := COALESCE(v_pos, '{}');

  IF cardinality(v_gids) <> (SELECT count(DISTINCT x) FROM unnest(v_gids) x) THEN
    RAISE EXCEPTION '같은 게임이 두 번 들어 있습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_pos) x WHERE x < 0 OR x > 999) THEN RAISE EXCEPTION '순서 값이 올바르지 않습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_gids) x
             WHERE x NOT IN (SELECT pool.id FROM public._fun_tier_pool(v_t.filter) pool)) THEN
    RAISE EXCEPTION '이 티어표에 없는 게임이 들어 있습니다.';
  END IF;

  IF p_labels IS NOT NULL THEN
    IF cardinality(p_labels) <> 5 THEN RAISE EXCEPTION '티어 이름은 5개여야 합니다.'; END IF;
    SELECT array_agg(btrim(COALESCE(x, '')) ORDER BY o) INTO v_labels FROM unnest(p_labels) WITH ORDINALITY AS u(x, o);
    IF EXISTS (SELECT 1 FROM unnest(v_labels) x WHERE char_length(x) > 10) THEN
      RAISE EXCEPTION '티어 이름은 10자까지 쓸 수 있어요.';
    END IF;
  END IF;

  INSERT INTO public.fun_tier_lists (user_id, template_id) VALUES (v_uid, v_t.id) ON CONFLICT DO NOTHING;
  SELECT * INTO v_list FROM public.fun_tier_lists WHERE user_id = v_uid AND template_id = v_t.id FOR UPDATE;

  IF p_seq IS NOT NULL AND v_list.last_seq IS NOT NULL AND p_seq < v_list.last_seq THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale', 'mine', public._fun_tier_my_json(v_uid, v_t));
  END IF;

  -- 빠진 게임
  SELECT array_agg(p.game_id) INTO v_removed
  FROM public.fun_tier_placements p
  WHERE p.user_id = v_uid AND p.template_id = v_t.id AND NOT (p.game_id = ANY (v_gids));
  v_removed := COALESCE(v_removed, '{}');

  DELETE FROM public.fun_tier_placements
  WHERE user_id = v_uid AND template_id = v_t.id AND game_id = ANY (v_removed);

  INSERT INTO public.fun_tier_placements AS tp (user_id, template_id, game_id, tier, pos)
  SELECT v_uid, v_t.id, u.g, u.t, u.p FROM unnest(v_gids, v_tiers, v_pos) AS u(g, t, p)
  ON CONFLICT (user_id, template_id, game_id) DO UPDATE
    SET tier = EXCLUDED.tier, pos = EXCLUDED.pos, updated_at = now()
    WHERE tp.tier <> EXCLUDED.tier OR tp.pos <> EXCLUDED.pos;

  -- 해봤음/안 해봄 (spec §5)
  -- 티어에 올림 → played (명시적 행동이라 다른 출처도 덮어쓴다)
  INSERT INTO public.user_game_marks AS um (user_id, game_id, status, source)
  SELECT v_uid, g, 'played', 'tier' FROM unnest(v_gids) g
  ON CONFLICT (user_id, game_id) DO UPDATE
    SET status = 'played', source = 'tier', run_id = NULL, updated_at = now()
    WHERE um.status <> 'played' OR um.source <> 'tier';

  -- 트레이로 뺌 → 티어표가 남긴 표시만 되돌린다. 본인 대여가 있으면 표시를 지워 대여 기준(played)으로
  DELETE FROM public.user_game_marks um
  WHERE um.user_id = v_uid AND um.game_id = ANY (v_removed) AND um.source = 'tier'
    AND EXISTS (SELECT 1 FROM public.rentals r
                WHERE r.user_id = v_uid AND r.game_id = um.game_id AND r.type = 'RENT' AND r.borrowed_at IS NOT NULL);
  UPDATE public.user_game_marks um
  SET status = 'unplayed', updated_at = now()
  WHERE um.user_id = v_uid AND um.game_id = ANY (v_removed) AND um.source = 'tier' AND um.status <> 'unplayed';

  -- 기준선 「전부 안 해봄」: 표시가 없고 본인 대여도 없는 후보만 (다른 출처의 표시는 건드리지 않는다).
  -- 매 저장마다 돌아서 나중에 템플릿에 들어온 게임도 같은 규칙
  INSERT INTO public.user_game_marks (user_id, game_id, status, source)
  SELECT v_uid, pool.id, 'unplayed', 'tier'
  FROM public._fun_tier_pool(v_t.filter) pool
  WHERE NOT (pool.id = ANY (v_gids))
    AND NOT EXISTS (SELECT 1 FROM public.rentals r
                    WHERE r.user_id = v_uid AND r.game_id = pool.id AND r.type = 'RENT' AND r.borrowed_at IS NOT NULL)
  ON CONFLICT (user_id, game_id) DO NOTHING;

  UPDATE public.fun_tier_lists
  SET labels = COALESCE(v_labels, labels),
      started_at = COALESCE(started_at, now()),
      last_seq = GREATEST(COALESCE(last_seq, 0), COALESCE(p_seq, 0)),
      updated_at = now()
  WHERE user_id = v_uid AND template_id = v_t.id;

  RETURN jsonb_build_object('ok', true, 'mine', public._fun_tier_my_json(v_uid, v_t));
END;
$function$;

-- 공개 켜기·끄기 (표가 없으면 머리만 만든다 — 기준선은 첫 저장 때)
CREATE OR REPLACE FUNCTION public.fun_tier_set_public(p_slug text, p_public boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_t   public.fun_tier_templates%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF p_public IS NULL THEN RAISE EXCEPTION '공개 여부가 필요합니다.'; END IF;
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;
  INSERT INTO public.fun_tier_lists (user_id, template_id, is_public) VALUES (v_uid, v_t.id, p_public)
  ON CONFLICT (user_id, template_id) DO UPDATE SET is_public = EXCLUDED.is_public, updated_at = now();
  RETURN p_public;
END;
$function$;

-- 모두의 티어 (spec §6) — 사람별 보정, 비회원도 본다. 이름은 내보내지 않는다
-- 집계 대상: 프로필이 있는(탈퇴 안 한) 회원, tester 제외
CREATE OR REPLACE FUNCTION public.fun_tier_community(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_t   public.fun_tier_templates%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;

  RETURN (
    WITH pool AS (
      SELECT pool.id FROM public._fun_tier_pool(v_t.filter) pool
    ),
    votes AS (
      SELECT pl.user_id, pl.game_id, pl.tier,
             (CASE pl.tier WHEN 'S' THEN 5 WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 ELSE 1 END)::numeric AS score
      FROM public.fun_tier_placements pl
      JOIN pool ON pool.id = pl.game_id
      JOIN public.profiles pr ON pr.id = pl.user_id
      WHERE pl.template_id = v_t.id
        AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pl.user_id AND ur.role_key = 'tester')
    ),
    mu AS (SELECT COALESCE(avg(score), 3) AS m FROM votes),
    raters AS (
      SELECT v.user_id, count(*) AS n, (avg(v.score) - mu.m) * count(*) / (count(*) + 3.0) AS off
      FROM votes v CROSS JOIN mu GROUP BY v.user_id, mu.m
    ),
    per_game AS (
      SELECT v.game_id, count(*) AS n,
             count(*) FILTER (WHERE v.tier = 'S') AS s, count(*) FILTER (WHERE v.tier = 'A') AS a,
             count(*) FILTER (WHERE v.tier = 'B') AS b, count(*) FILTER (WHERE v.tier = 'C') AS c,
             count(*) FILTER (WHERE v.tier = 'D') AS d,
             avg(v.score) AS raw_avg, avg(v.score - r.off) AS adj_avg
      FROM votes v JOIN raters r ON r.user_id = v.user_id
      GROUP BY v.game_id
    ),
    items AS (
      SELECT g.id, g.name, g.image, g.min_players, g.max_players, g.playingtime,
             COALESCE(pg.n, 0) AS n, pg.s, pg.a, pg.b, pg.c, pg.d, pg.raw_avg, pg.adj_avg,
             CASE WHEN pg.adj_avg IS NULL THEN NULL
                  WHEN pg.adj_avg >= 4.5 THEN 'S' WHEN pg.adj_avg >= 3.5 THEN 'A'
                  WHEN pg.adj_avg >= 2.5 THEN 'B' WHEN pg.adj_avg >= 1.5 THEN 'C' ELSE 'D' END AS tier,
             COALESCE(pg.n, 0) >= v_t.min_sample
               AND (pg.s + pg.a)::numeric / pg.n >= 0.25
               AND (pg.c + pg.d)::numeric / pg.n >= 0.25 AS split
      FROM pool JOIN public.games g ON g.id = pool.id
      LEFT JOIN per_game pg ON pg.game_id = pool.id
    )
    SELECT jsonb_build_object(
      'slug', v_t.slug,
      'title', v_t.title,
      'min_sample', v_t.min_sample,
      'shrink_k', 3,
      'split_share', 0.25,
      'raters', (SELECT count(*) FROM raters),
      'global_mean', (SELECT round(m, 3) FROM mu),
      'my_offset', (SELECT round(off, 3) FROM raters WHERE user_id = v_uid),
      'my_count', (SELECT n FROM raters WHERE user_id = v_uid),
      'items', COALESCE(jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'image', i.image,
        'min_players', i.min_players, 'max_players', i.max_players, 'playingtime', i.playingtime,
        'n', i.n, 'tier', i.tier, 'split', COALESCE(i.split, false),
        'avg', round(i.adj_avg, 3), 'raw_avg', round(i.raw_avg, 3),
        'dist', jsonb_build_object('S', COALESCE(i.s, 0), 'A', COALESCE(i.a, 0), 'B', COALESCE(i.b, 0),
                                   'C', COALESCE(i.c, 0), 'D', COALESCE(i.d, 0))
      ) ORDER BY i.adj_avg DESC NULLS LAST, i.n DESC, i.name), '[]'::jsonb)
    )
    FROM items i
  );
END;
$function$;

-- 공개된 티어표 목록 (회원만 — 이름이 붙은 정보)
CREATE OR REPLACE FUNCTION public.fun_tier_public_lists(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.fun_tier_templates%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', x.name, 'count', x.cnt, 'updated_at', x.updated_at)
                     ORDER BY x.updated_at DESC)
    FROM (
      SELECT l.user_id, pr.name, l.updated_at,
             (SELECT count(*) FROM public.fun_tier_placements p
              WHERE p.user_id = l.user_id AND p.template_id = l.template_id) AS cnt
      FROM public.fun_tier_lists l
      JOIN public.profiles pr ON pr.id = l.user_id
      WHERE l.template_id = v_t.id AND l.is_public
      ORDER BY l.updated_at DESC
      LIMIT 200
    ) x
    WHERE x.cnt > 0
  ), '[]'::jsonb);
END;
$function$;

-- 회원 공개 티어표 하나 (회원만). 비공개·없는 회원은 NULL — 존재 여부를 구분하지 않는다. 본인 것은 비공개여도
CREATE OR REPLACE FUNCTION public.fun_tier_get_public(p_slug text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_t    public.fun_tier_templates%ROWTYPE;
  v_list public.fun_tier_lists%ROWTYPE;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;

  SELECT l.* INTO v_list FROM public.fun_tier_lists l
  WHERE l.user_id = p_user_id AND l.template_id = v_t.id AND (l.is_public OR l.user_id = v_uid);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'user_id', v_list.user_id, 'name', v_name, 'is_me', v_list.user_id = v_uid,
    'is_public', v_list.is_public, 'labels', to_jsonb(v_list.labels), 'updated_at', v_list.updated_at,
    'placements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('game_id', p.game_id, 'tier', p.tier, 'pos', p.pos)
                       ORDER BY p.tier, p.pos, p.game_id)
      FROM public.fun_tier_placements p
      JOIN public._fun_tier_pool(v_t.filter) pool ON pool.id = p.game_id
      WHERE p.user_id = v_list.user_id AND p.template_id = v_t.id
    ), '[]'::jsonb)
  );
END;
$function$;

-- 리뷰 작성자 뱃지: 이 게임에 대한 공개 티어 (회원만). { "user_id": "S", ... }
CREATE OR REPLACE FUNCTION public.fun_tier_public_badges(p_game_id integer, p_user_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN RETURN '{}'::jsonb; END IF;
  IF cardinality(p_user_ids) > 100 THEN RAISE EXCEPTION '한 번에 100명까지만 조회할 수 있습니다.'; END IF;
  RETURN COALESCE((
    SELECT jsonb_object_agg(x.user_id::text, x.tier)
    FROM (
      SELECT DISTINCT ON (p.user_id) p.user_id, p.tier
      FROM public.fun_tier_placements p
      JOIN public.fun_tier_lists l ON l.user_id = p.user_id AND l.template_id = p.template_id AND l.is_public
      JOIN public.fun_tier_templates t ON t.id = p.template_id AND t.is_active
      WHERE p.game_id = p_game_id AND p.user_id = ANY (p_user_ids)
      ORDER BY p.user_id, t.sort_order
    ) x
  ), '{}'::jsonb);
END;
$function$;

-- ── 운영진 ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fun_tier_admin_reset_labels(p_slug text, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  UPDATE public.fun_tier_lists l
  SET labels = ARRAY['', '', '', '', '']::text[], updated_at = now()
  FROM public.fun_tier_templates t
  WHERE t.slug = p_slug AND l.template_id = t.id AND l.user_id = p_user_id;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fun_tier_admin_stats(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.fun_tier_templates%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  SELECT * INTO v_t FROM public.fun_tier_templates WHERE slug = p_slug;
  IF NOT FOUND THEN RAISE EXCEPTION '티어표를 찾을 수 없습니다.'; END IF;
  RETURN jsonb_build_object(
    'lists', (SELECT count(*) FROM public.fun_tier_lists WHERE template_id = v_t.id),
    'participants', (SELECT count(DISTINCT user_id) FROM public.fun_tier_placements WHERE template_id = v_t.id),
    'public', (SELECT count(*) FROM public.fun_tier_lists WHERE template_id = v_t.id AND is_public),
    'community', CASE WHEN v_t.is_active THEN public.fun_tier_community(p_slug) END
  );
END;
$function$;

-- ── 권한 ─────────────────────────────────────────────────────────
-- CREATE FUNCTION 기본값이 PUBLIC EXECUTE 라 PUBLIC 부터 회수하고 필요한 역할에만 준다

REVOKE ALL ON FUNCTION public.fun_tier_get_template(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fun_tier_community(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fun_tier_my(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fun_tier_save(text, jsonb, text[], bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fun_tier_set_public(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fun_tier_public_lists(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fun_tier_get_public(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fun_tier_public_badges(integer, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fun_tier_admin_reset_labels(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fun_tier_admin_stats(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fun_tier_get_template(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fun_tier_community(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fun_tier_my(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_tier_save(text, jsonb, text[], bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_tier_set_public(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_tier_public_lists(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_tier_get_public(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_tier_public_badges(integer, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_tier_admin_reset_labels(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fun_tier_admin_stats(text) TO authenticated;
