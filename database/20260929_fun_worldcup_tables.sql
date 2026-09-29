-- ================================================================
-- MIGRATION: fun_worldcup_tables
-- 날짜: 2026-09-29
-- 배경: 놀이 콘텐츠 1탄 — 보드게임 이상형 월드컵 (spec_fun_worldcup.md)
--       판(run)과 1:1 대결(match)을 전부 기록한다.
--
-- 접근 원칙: 세 테이블 모두 RLS 켬 + 정책 없음 + anon/authenticated GRANT 없음.
--            읽기·쓰기는 fun_wc_* SECURITY DEFINER RPC 로만 한다.
-- ================================================================

CREATE TABLE public.fun_worldcup_themes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  title         text NOT NULL,
  description   text,
  -- { "category": "보드게임", "rentable_only": true, "require_image": true, "genres_any": ["파티"] }
  filter        jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_sizes int[] NOT NULL DEFAULT '{8,16,32,64}'
                CHECK (allowed_sizes <@ '{4,8,16,32,64,128}'::int[] AND cardinality(allowed_sizes) > 0),
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.fun_worldcup_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id         uuid NOT NULL REFERENCES public.fun_worldcup_themes(id),
  size             int NOT NULL CHECK (size IN (4, 8, 16, 32, 64, 128)),
  bracket          int[] NOT NULL,          -- 서버가 발급한 대진 (game_id 순서)
  top_first        boolean[] NOT NULL,      -- 대결 순번별: true 면 대진상 앞 후보가 위(top)
  user_id          uuid,                    -- 회원이면 채움 (auth.uid())
  anon_id          uuid,                    -- 기기 식별자 (localStorage 무작위 UUID)
  is_member        boolean NOT NULL,
  status           text NOT NULL DEFAULT 'started'
                   CHECK (status IN ('started', 'finished', 'abandoned')),
  champion_game_id int,                     -- games FK 없음: 게임이 삭제돼도 기록 보존
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL),
  CHECK (cardinality(bracket) = size AND cardinality(top_first) = size - 1)
);

CREATE INDEX fun_worldcup_runs_theme_status_idx ON public.fun_worldcup_runs (theme_id, status);
CREATE INDEX fun_worldcup_runs_anon_started_idx ON public.fun_worldcup_runs (anon_id, started_at) WHERE anon_id IS NOT NULL;
CREATE INDEX fun_worldcup_runs_user_started_idx ON public.fun_worldcup_runs (user_id, started_at) WHERE user_id IS NOT NULL;
CREATE INDEX fun_worldcup_runs_started_open_idx ON public.fun_worldcup_runs (started_at) WHERE status = 'started';

CREATE TABLE public.fun_worldcup_matches (
  run_id          uuid NOT NULL REFERENCES public.fun_worldcup_runs(id) ON DELETE CASCADE,
  round_size      int NOT NULL,             -- 이 대결이 속한 라운드의 강수 (2 = 결승)
  match_no        int NOT NULL,             -- 라운드 안 순번 (1부터)
  top_game_id     int NOT NULL,
  bottom_game_id  int NOT NULL,
  winner_game_id  int NOT NULL,
  picked_top      boolean NOT NULL,         -- 위치 편향 분석용
  decide_ms       int,                      -- 고르는 데 걸린 시간
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, round_size, match_no),
  CHECK (winner_game_id IN (top_game_id, bottom_game_id))
);

CREATE INDEX fun_worldcup_matches_top_idx ON public.fun_worldcup_matches (top_game_id);
CREATE INDEX fun_worldcup_matches_bottom_idx ON public.fun_worldcup_matches (bottom_game_id);

-- RPC 전용: RLS 켜고 정책 없음, 직접 권한 회수
ALTER TABLE public.fun_worldcup_themes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fun_worldcup_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fun_worldcup_matches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fun_worldcup_themes  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fun_worldcup_runs    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fun_worldcup_matches FROM PUBLIC, anon, authenticated;

-- 기본 테마 (머더미스터리·TRPG 제외, 대여 가능 + 이미지 있는 보드게임)
INSERT INTO public.fun_worldcup_themes (slug, title, description, filter, allowed_sizes, sort_order)
VALUES (
  'all-boardgames',
  '보드게임 이상형 월드컵',
  '덜지니어스에 있는 보드게임 중 나의 원픽은?',
  '{"category": "보드게임", "rentable_only": true, "require_image": true}'::jsonb,
  '{8,16,32,64}',
  0
);
