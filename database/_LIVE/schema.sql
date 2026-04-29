-- ================================================================
-- SCHEMA — Tables (public schema 현재 배포 상태)
-- 프로젝트: hptvqangstiaatdtusrg
-- 생성 시각: 2026. 4. 29. PM 6:26:40
-- 생성 스크립트: scripts/pull_schema.js
-- (자동 생성 파일 — 직접 수정하지 마세요)
-- ================================================================

-- 총 20개 테이블

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
-- 테이블: event_payment_logs
-- ----------------------------------------------------------------
CREATE TABLE public.event_payment_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_id uuid NOT NULL,  -- FK → event_registrations(id)
  action text NOT NULL,
  amount int4,
  note text,
  performed_by uuid,  -- FK → profiles(id)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------
-- 테이블: event_registrations
-- ----------------------------------------------------------------
CREATE TABLE public.event_registrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL,  -- FK → events(id)
  team_id uuid,  -- FK → event_teams(id)
  user_id uuid NOT NULL,  -- FK → profiles(id)
  applicant_name text NOT NULL,
  applicant_student_id text,
  applicant_phone text,
  membership_tier text NOT NULL,
  fee_amount int4 NOT NULL DEFAULT 0,
  is_invited bool NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'::text,
  payment_deadline_at timestamptz,
  payment_received_at timestamptz,
  expected_depositor_name text,
  actual_depositor_name text,
  extra_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  privacy_consent_at timestamptz,
  photo_consent bool NOT NULL DEFAULT false,
  checked_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancel_reason text
);

-- ----------------------------------------------------------------
-- 테이블: event_teams
-- ----------------------------------------------------------------
CREATE TABLE public.event_teams (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL,  -- FK → events(id)
  team_name text NOT NULL,
  invite_code text NOT NULL,
  leader_user_id uuid NOT NULL,  -- FK → profiles(id)
  size_target int4 NOT NULL,
  status text NOT NULL DEFAULT 'forming'::text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------
-- 테이블: events
-- ----------------------------------------------------------------
CREATE TABLE public.events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL,
  title text NOT NULL,
  subtitle text,
  status text NOT NULL DEFAULT 'draft'::text,
  hero_image_url text,
  bg_color text DEFAULT '#1a1a2e'::text,
  accent_color text DEFAULT '#667eea'::text,
  extra_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  recruit_start_at timestamptz NOT NULL,
  recruit_end_at timestamptz NOT NULL,
  event_start_at timestamptz NOT NULL,
  event_end_at timestamptz,
  location text,
  capacity int4,
  capacity_unit text NOT NULL DEFAULT 'person'::text,
  waitlist_enabled bool NOT NULL DEFAULT true,
  participation_mode text NOT NULL DEFAULT 'individual'::text,
  team_size_min int4,
  team_size_max int4,
  pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_bank text,
  account_number text,
  account_holder text,
  toss_send_url text,
  kakaopay_send_url text,
  payment_deadline_hours int4 NOT NULL DEFAULT 48,
  description text,
  schedule_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  faq_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  prize_text text,
  refund_policy text,
  extra_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  require_privacy_consent bool NOT NULL DEFAULT true,
  require_photo_consent bool NOT NULL DEFAULT false,
  created_by uuid,  -- FK → profiles(id)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  allow_walk_in bool NOT NULL DEFAULT true
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
-- 테이블: private_config
-- ----------------------------------------------------------------
CREATE TABLE public.private_config (
  key text NOT NULL PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
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
  status text DEFAULT 'active'::text,
  last_paid_semester text
);

-- ----------------------------------------------------------------
-- 테이블: rental_requests
-- ----------------------------------------------------------------
CREATE TABLE public.rental_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  requester_name text NOT NULL,
  requester_phone text NOT NULL,
  org_type text,
  org_name text,
  event_overview text,
  event_schedule text,
  audience_notes text,
  requested_games_raw text NOT NULL,
  game_count int4,
  rental_fee int4,
  rental_duration_raw text,
  pickup_raw text,
  is_free bool NOT NULL DEFAULT false,
  matched_game_ids _int4 NOT NULL DEFAULT '{}'::integer[],
  pickup_at timestamptz,
  duration_days int4,
  status text NOT NULL DEFAULT 'pending'::text,
  review_note text,
  reviewed_by uuid,  -- FK → profiles(id)
  reviewed_at timestamptz,
  hold_rental_ids _uuid NOT NULL DEFAULT '{}'::uuid[],
  raw_payload jsonb
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
