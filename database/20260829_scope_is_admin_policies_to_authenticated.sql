-- ================================================================
-- MIGRATION: scope_is_admin_policies_to_authenticated
-- 날짜: 2026-08-29
-- 설명: is_admin()을 사용하는 RLS 정책을 anon이 평가하지 않도록
--       public 대상 정책을 authenticated 전용으로 제한한다.
--
-- 의도적으로 anon에게 is_admin() EXECUTE 권한을 부여하지 않는다.
-- 공개 조회 정책은 별도의 USING 조건(true 등)으로 계속 동작한다.
-- ================================================================

-- 관리자 전용 정책
ALTER POLICY "Admin Manage Config" ON public.app_config
  TO authenticated;

ALTER POLICY "Admin Manage Reports" ON public.damage_reports
  TO authenticated;

ALTER POLICY "event_payment_logs_admin" ON public.event_payment_logs
  TO authenticated;

ALTER POLICY "event_regs_admin_write" ON public.event_registrations
  TO authenticated;

ALTER POLICY "event_teams_admin_write" ON public.event_teams
  TO authenticated;

ALTER POLICY "events_admin_read" ON public.events
  TO authenticated;

ALTER POLICY "events_admin_write" ON public.events
  TO authenticated;

ALTER POLICY "Admin Manage Stats" ON public.game_daily_stats
  TO authenticated;

ALTER POLICY "Admin Manage Requests" ON public.game_requests
  TO authenticated;

ALTER POLICY "Admin Manage Games" ON public.games
  TO authenticated;

ALTER POLICY "Admin Manage Logs" ON public.logs
  TO authenticated;

ALTER POLICY "Admin View Logs" ON public.logs
  TO authenticated;

ALTER POLICY "Admin Manage Matches" ON public.matches
  TO authenticated;

ALTER POLICY "Admin Manage Points" ON public.point_transactions
  TO authenticated;

ALTER POLICY "Admin View All Points" ON public.point_transactions
  TO authenticated;

ALTER POLICY "Admin Manage Profiles" ON public.profiles
  TO authenticated;

ALTER POLICY "Admin Read All Profiles" ON public.profiles
  TO authenticated;

ALTER POLICY "Admin Manage Rental Requests" ON public.rental_requests
  TO authenticated;

ALTER POLICY "Admin Manage Rentals" ON public.rentals
  TO authenticated;

ALTER POLICY "Admin Manage Reviews" ON public.reviews
  TO authenticated;

ALTER POLICY "Admin Manage Roles" ON public.user_roles
  TO authenticated;

-- 인증 사용자 전용 조회 정책.
-- anon은 이 정책을 평가하지 않으므로 is_admin() 권한 오류가 발생하지 않는다.
ALTER POLICY "event_regs_self_read" ON public.event_registrations
  TO authenticated;

ALTER POLICY "event_teams_read" ON public.event_teams
  TO authenticated;

ALTER POLICY "User View Own Matches" ON public.matches
  TO authenticated;

ALTER POLICY "Read Rentals for Owner or Admin" ON public.rentals
  TO authenticated;
