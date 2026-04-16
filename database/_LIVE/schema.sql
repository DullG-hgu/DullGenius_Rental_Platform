-- ================================================================
-- SCHEMA — Tables (public schema 현재 배포 상태)
-- 프로젝트: hptvqangstiaatdtusrg
-- 생성 시각: 2026. 4. 16. PM 6:30:23
-- 생성 스크립트: scripts/pull_schema.js
-- (자동 생성 파일 — 직접 수정하지 마세요)
-- ================================================================

-- 총 14개 테이블

-- ----------------------------------------------------------------
-- 테이블: allowed_users
-- ----------------------------------------------------------------
CREATE TABLE public.allowed_users (
  student_id text NOT NULL PRIMARY KEY,
  name text NOT NULL,
  phone text,
  role text DEFAULT 'member'::text,
  joined_semester text
);

-- ----------------------------------------------------------------
-- 테이블: app_config
-- ----------------------------------------------------------------
CREATE TABLE public.app_config (
  key text NOT NULL PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------
-- 테이블: damage_reports
-- ----------------------------------------------------------------
CREATE TABLE public.damage_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,  -- FK → profiles(id)
  game_id int8,  -- FK → games(id)
  game_name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  status text DEFAULT 'pending'::text
);

-- ----------------------------------------------------------------
-- 테이블: game_daily_stats
-- ----------------------------------------------------------------
CREATE TABLE public.game_daily_stats (
  id int8 NOT NULL PRIMARY KEY,
  game_id int4 NOT NULL,  -- FK → games(id)
  date date NOT NULL DEFAULT CURRENT_DATE,
  view_count int4 DEFAULT 1
);

-- ----------------------------------------------------------------
-- 테이블: game_requests
-- ----------------------------------------------------------------
CREATE TABLE public.game_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,  -- FK → profiles(id)
  game_title text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  status text DEFAULT 'pending'::text
);

-- ----------------------------------------------------------------
-- 테이블: games
-- ----------------------------------------------------------------
CREATE TABLE public.games (
  id int4 NOT NULL DEFAULT nextval('games_id_seq'::regclass) PRIMARY KEY,
  name text NOT NULL,
  category text,
  image text,
  naver_id text,
  bgg_id text,
  difficulty numeric,
  tags text,
  total_views int4 DEFAULT 0,
  dibs_count int4 DEFAULT 0,
  review_count int4 DEFAULT 0,
  avg_rating numeric DEFAULT 0.0,
  created_at timestamptz DEFAULT now(),
  video_url text,
  manual_url text,
  quantity int4 DEFAULT 1,
  available_count int4,
  recommendation_text text,
  is_rentable bool DEFAULT true,
  owner text,
  playingtime text,
  min_players int4,
  max_players int4,
  genres _text,
  min_playtime int4,
  max_playtime int4
);

-- ----------------------------------------------------------------
-- 테이블: logs
-- ----------------------------------------------------------------
CREATE TABLE public.logs (
  log_id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id int4,  -- FK → games(id)
  user_id uuid,  -- FK → profiles(id)
  action_type text NOT NULL,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------
-- 테이블: matches
-- ----------------------------------------------------------------
CREATE TABLE public.matches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id int4,  -- FK → games(id)
  played_at timestamptz DEFAULT timezone('kst'::text, now()),
  players jsonb NOT NULL,
  winner_id uuid,
  verified_at timestamptz
);

-- ----------------------------------------------------------------
-- 테이블: point_transactions
-- ----------------------------------------------------------------
CREATE TABLE public.point_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,  -- FK → profiles(id)
  amount int4 NOT NULL,
  type text,
  reason text,
  created_at timestamptz DEFAULT timezone('kst'::text, now())
);

-- ----------------------------------------------------------------
-- 테이블: profiles
-- ----------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid NOT NULL PRIMARY KEY,
  student_id text NOT NULL,
  name text NOT NULL,
  phone text,
  is_paid bool DEFAULT false,
  penalty int4 DEFAULT 0,
  joined_semester text,
  activity_point int4 DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  current_points int4 DEFAULT 0,
  is_semester_fixed bool DEFAULT false,
  status text DEFAULT 'active'::text
);

-- ----------------------------------------------------------------
-- 테이블: rentals
-- ----------------------------------------------------------------
CREATE TABLE public.rentals (
  rental_id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,  -- FK → profiles(id)
  game_name text,
  borrowed_at timestamptz DEFAULT now(),
  due_date timestamptz NOT NULL,
  returned_at timestamptz,
  extension_count int4 DEFAULT 0,
  overdue_fee int4 DEFAULT 0,
  note text,
  type text DEFAULT 'RENT'::text,
  renter_name text,
  game_id int4 NOT NULL,  -- FK → games(id)
  source text DEFAULT 'admin'::text
);

-- ----------------------------------------------------------------
-- 테이블: reviews
-- ----------------------------------------------------------------
CREATE TABLE public.reviews (
  review_id int4 NOT NULL DEFAULT nextval('reviews_review_id_seq'::regclass) PRIMARY KEY,
  game_id int4,  -- FK → games(id)
  user_id uuid,  -- FK → profiles(id)
  author_name text NOT NULL,
  rating int4,
  content text,
  created_at timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------
-- 테이블: roles
-- ----------------------------------------------------------------
CREATE TABLE public.roles (
  role_key text NOT NULL PRIMARY KEY,
  display_name text NOT NULL,
  permissions jsonb DEFAULT '{}'::jsonb
);

-- ----------------------------------------------------------------
-- 테이블: user_roles
-- ----------------------------------------------------------------
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL PRIMARY KEY,  -- FK → profiles(id)
  user_id uuid NOT NULL PRIMARY KEY,  -- FK → profiles(id)
  role_key text NOT NULL PRIMARY KEY,  -- FK → roles(role_key)
  assigned_at timestamptz DEFAULT now()
);
