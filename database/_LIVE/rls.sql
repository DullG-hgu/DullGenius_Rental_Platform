-- ================================================================
-- RLS POLICIES — public schema 현재 배포 상태
-- 프로젝트: hptvqangstiaatdtusrg
-- 생성 시각: 2026. 6. 16. PM 4:01:26
-- 생성 스크립트: scripts/pull_schema.js
-- (자동 생성 파일 — 직접 수정하지 마세요)
-- ================================================================

-- 총 46개 정책

-- ----------------------------------------------------------------
-- 테이블: app_config  (2개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Config" ON public.app_config
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Allow public read access" ON public.app_config
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

-- ----------------------------------------------------------------
-- 테이블: damage_reports  (3개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.damage_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Reports" ON public.damage_reports
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "User Create Report" ON public.damage_reports
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id))
;

CREATE POLICY "User View Own Report" ON public.damage_reports
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id))
;

-- ----------------------------------------------------------------
-- 테이블: event_payment_logs  (1개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.event_payment_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_payment_logs_admin" ON public.event_payment_logs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
  WITH CHECK (is_admin())
;

-- ----------------------------------------------------------------
-- 테이블: event_registrations  (2개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_regs_admin_write" ON public.event_registrations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
  WITH CHECK (is_admin())
;

CREATE POLICY "event_regs_self_read" ON public.event_registrations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_admin() OR (user_id = auth.uid()) OR ((team_id IS NOT NULL) AND is_event_team_leader(team_id))))
;

-- ----------------------------------------------------------------
-- 테이블: event_teams  (2개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.event_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_teams_admin_write" ON public.event_teams
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
  WITH CHECK (is_admin())
;

CREATE POLICY "event_teams_read" ON public.event_teams
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_admin() OR (leader_user_id = auth.uid()) OR is_event_team_member(id)))
;

-- ----------------------------------------------------------------
-- 테이블: events  (3개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_admin_read" ON public.events
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (is_admin())
;

CREATE POLICY "events_admin_write" ON public.events
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
  WITH CHECK (is_admin())
;

CREATE POLICY "events_public_read" ON public.events
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((deleted_at IS NULL) AND (status <> ALL (ARRAY['draft'::text, 'archived'::text]))))
;

-- ----------------------------------------------------------------
-- 테이블: game_daily_stats  (2개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.game_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Stats" ON public.game_daily_stats
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Public Read Stats" ON public.game_daily_stats
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

-- ----------------------------------------------------------------
-- 테이블: game_requests  (3개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.game_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Requests" ON public.game_requests
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "User Create Request" ON public.game_requests
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id))
;

CREATE POLICY "User View Own Request" ON public.game_requests
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id))
;

-- ----------------------------------------------------------------
-- 테이블: games  (2개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Games" ON public.games
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Allow public read access" ON public.games
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

-- ----------------------------------------------------------------
-- 테이블: logs  (2개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Logs" ON public.logs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Admin View Logs" ON public.logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (is_admin())
;

-- ----------------------------------------------------------------
-- 테이블: matches  (2개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Matches" ON public.matches
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "User View Own Matches" ON public.matches
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((players @> to_jsonb(auth.uid())) OR (winner_id = auth.uid()) OR is_admin()))
;

-- ----------------------------------------------------------------
-- 테이블: point_transactions  (3개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Points" ON public.point_transactions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Admin View All Points" ON public.point_transactions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (is_admin())
;

CREATE POLICY "View Own Points" ON public.point_transactions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id))
;

-- ----------------------------------------------------------------
-- 테이블: private_config  (1개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.private_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny All" ON public.private_config
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

-- ----------------------------------------------------------------
-- 테이블: profiles  (5개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Profiles" ON public.profiles
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Admin Read All Profiles" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (is_admin())
;

CREATE POLICY "Kiosk read all profiles" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role_key = 'kiosk'::text)))))
;

CREATE POLICY "Read Own Profile" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = id))
;

CREATE POLICY "Update Own Profile" ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = id))
;

-- ----------------------------------------------------------------
-- 테이블: rental_requests  (1개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.rental_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Rental Requests" ON public.rental_requests
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
  WITH CHECK (is_admin())
;

-- ----------------------------------------------------------------
-- 테이블: rentals  (4개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Rentals" ON public.rentals
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Create Own Rentals" ON public.rentals
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id))
;

CREATE POLICY "Public view active rentals" ON public.rentals
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((returned_at IS NULL))
;

CREATE POLICY "Read Rentals for Owner or Admin" ON public.rentals
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((auth.uid() = user_id) OR is_admin()))
;

-- ----------------------------------------------------------------
-- 테이블: reviews  (3개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Reviews" ON public.reviews
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Manage Own Reviews" ON public.reviews
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = user_id))
;

CREATE POLICY "Public Read" ON public.reviews
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

-- ----------------------------------------------------------------
-- 테이블: roles  (1개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read" ON public.roles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

-- ----------------------------------------------------------------
-- 테이블: user_roles  (4개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Roles" ON public.user_roles
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Admins can do everything on user_roles" ON public.user_roles
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin())
;

CREATE POLICY "Read Own Roles" ON public.user_roles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id))
;

CREATE POLICY "Users can read own roles" ON public.user_roles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id))
;
