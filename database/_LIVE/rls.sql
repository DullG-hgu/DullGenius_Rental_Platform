-- ================================================================
-- RLS POLICIES — public schema 현재 배포 상태
-- 프로젝트: hptvqangstiaatdtusrg
-- 생성 시각: 2026. 4. 11. PM 3:22:11
-- 생성 스크립트: scripts/pull_schema.js
-- (자동 생성 파일 — 직접 수정하지 마세요)
-- ================================================================

-- 총 56개 정책

-- ----------------------------------------------------------------
-- 테이블: app_config  (4개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Config" ON public.app_config
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Allow authenticated insert/update" ON public.app_config
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.role() = 'authenticated'::text))
  WITH CHECK ((auth.role() = 'authenticated'::text))
;

CREATE POLICY "Allow public read access" ON public.app_config
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

CREATE POLICY "Public Read Config" ON public.app_config
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

-- ----------------------------------------------------------------
-- 테이블: damage_reports  (6개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.damage_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Reports" ON public.damage_reports
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Admins can do everything on damage_reports" ON public.damage_reports
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role_key = ANY (ARRAY['admin'::text, 'executive'::text, 'staff'::text]))))))
;

CREATE POLICY "Authenticated users can insert damage reports" ON public.damage_reports
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.role() = 'authenticated'::text))
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

CREATE POLICY "Users can see their own reports" ON public.damage_reports
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id))
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
-- 테이블: game_requests  (6개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.game_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Requests" ON public.game_requests
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Admins can do everything on game_requests" ON public.game_requests
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role_key = ANY (ARRAY['admin'::text, 'executive'::text, 'staff'::text]))))))
;

CREATE POLICY "Authenticated users can insert game requests" ON public.game_requests
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.role() = 'authenticated'::text))
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

CREATE POLICY "Users can see their own requests" ON public.game_requests
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id))
;

-- ----------------------------------------------------------------
-- 테이블: games  (5개 정책)
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

CREATE POLICY "Games viewable by everyone" ON public.games
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

CREATE POLICY "Public Read" ON public.games
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

CREATE POLICY "Public Read Games" ON public.games
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

-- ----------------------------------------------------------------
-- 테이블: logs  (3개 정책)
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

CREATE POLICY "Public Read Logs" ON public.logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
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
-- 테이블: profiles  (7개 정책)
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

CREATE POLICY "Admin View All Profiles" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role_key = ANY (ARRAY['admin'::text, 'executive'::text]))))))
;

CREATE POLICY "Authenticated users read own profile" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = id))
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

CREATE POLICY "View Own Profile" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = id))
;

-- ----------------------------------------------------------------
-- 테이블: rentals  (6개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Rentals" ON public.rentals
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Admin View All Rentals" ON public.rentals
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role_key = ANY (ARRAY['admin'::text, 'executive'::text]))))))
;

CREATE POLICY "Create Own Rentals" ON public.rentals
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id))
;

CREATE POLICY "Rentals viewable by everyone" ON public.rentals
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

CREATE POLICY "User View Own Rentals" ON public.rentals
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id))
;

CREATE POLICY "View Own Rentals" ON public.rentals
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()))
;

-- ----------------------------------------------------------------
-- 테이블: reviews  (7개 정책)
-- ----------------------------------------------------------------
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Manage Reviews" ON public.reviews
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin())
;

CREATE POLICY "Enable delete for users based on user_id" ON public.reviews
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id))
;

CREATE POLICY "Enable insert for authenticated users only" ON public.reviews
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id))
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

CREATE POLICY "Public Read Reviews" ON public.reviews
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true)
;

CREATE POLICY "본인 리뷰 수정 가능" ON public.reviews
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id))
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
