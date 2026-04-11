-- [SECURITY] Apply RLS to All Tables (Fixed Idempotency)
-- 이 스크립트는 모든 테이블에 Row Level Security(RLS)를 적용하고, 
-- 명시적인 허용 정책(Policy)을 정의하여 비인가 접근을 차단합니다.
-- (재실행 시 에러가 발생하지 않도록 DROP 구문을 모두 포함했습니다.)

-- ============================================================
-- 1. 유틸리티 함수 (관리자 체크)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
      AND role_key IN ('admin', 'executive', 'kiosk')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. 테이블별 RLS 적용 및 정책 설정
-- ============================================================

-- [2-1] Games (게임 정보)
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Games" ON public.games;
DROP POLICY IF EXISTS "Admin Manage Games" ON public.games;
DROP POLICY IF EXISTS "Enable all modifications for all users" ON public.games; 

CREATE POLICY "Public Read Games" ON public.games FOR SELECT USING (true);
CREATE POLICY "Admin Manage Games" ON public.games FOR ALL USING (public.is_admin());


-- [2-2] Profiles (유저 프로필 - 민감정보 포함)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Own Profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin Read All Profiles" ON public.profiles;
DROP POLICY IF EXISTS "Update Own Profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin Manage Profiles" ON public.profiles;

CREATE POLICY "Read Own Profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admin Read All Profiles" ON public.profiles FOR SELECT USING (public.is_admin());
CREATE POLICY "Update Own Profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin Manage Profiles" ON public.profiles FOR ALL USING (public.is_admin());


-- [2-3] Rentals (대여 기록)
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Rentals" ON public.rentals;
DROP POLICY IF EXISTS "Admin Manage Rentals" ON public.rentals;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.rentals;
DROP POLICY IF EXISTS "Enable update for all users" ON public.rentals;
DROP POLICY IF EXISTS "Enable select for all users" ON public.rentals;

CREATE POLICY "Public Read Rentals" ON public.rentals FOR SELECT USING (true);
CREATE POLICY "Admin Manage Rentals" ON public.rentals FOR ALL USING (public.is_admin());


-- [2-4] Logs (로그)
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin View Logs" ON public.logs;
DROP POLICY IF EXISTS "System Insert Logs" ON public.logs;
DROP POLICY IF EXISTS "Admin Manage Logs" ON public.logs;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.logs;
DROP POLICY IF EXISTS "Enable select for all users" ON public.logs;

CREATE POLICY "Admin View Logs" ON public.logs FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin Manage Logs" ON public.logs FOR ALL USING (public.is_admin());


-- [2-5] User Roles (권한 관리)
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Own Roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admin Manage Roles" ON public.user_roles;

CREATE POLICY "Read Own Roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admin Manage Roles" ON public.user_roles FOR ALL USING (public.is_admin());


-- [2-6] Reviews (리뷰)
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Reviews" ON public.reviews;
DROP POLICY IF EXISTS "Manage Own Reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admin Manage Reviews" ON public.reviews;

CREATE POLICY "Public Read Reviews" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "Manage Own Reviews" ON public.reviews FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admin Manage Reviews" ON public.reviews FOR ALL USING (public.is_admin());


-- [2-7] Point Transactions (포인트 내역)
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View Own Points" ON public.point_transactions;
DROP POLICY IF EXISTS "Admin View All Points" ON public.point_transactions;
DROP POLICY IF EXISTS "Admin Manage Points" ON public.point_transactions;

CREATE POLICY "View Own Points" ON public.point_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admin View All Points" ON public.point_transactions FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin Manage Points" ON public.point_transactions FOR ALL USING (public.is_admin());


-- [2-8] App Config (설정)
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Config" ON public.app_config;
DROP POLICY IF EXISTS "Admin Manage Config" ON public.app_config;

CREATE POLICY "Public Read Config" ON public.app_config FOR SELECT USING (true);
CREATE POLICY "Admin Manage Config" ON public.app_config FOR ALL USING (public.is_admin());


-- [2-9] Game Daily Stats (통계)
ALTER TABLE public.game_daily_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Stats" ON public.game_daily_stats;
DROP POLICY IF EXISTS "Admin Manage Stats" ON public.game_daily_stats;

CREATE POLICY "Public Read Stats" ON public.game_daily_stats FOR SELECT USING (true);
CREATE POLICY "Admin Manage Stats" ON public.game_daily_stats FOR ALL USING (public.is_admin());


-- [2-10] 기타 테이블 (Damage Reports, Game Requests)
ALTER TABLE public.damage_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User Create Report" ON public.damage_reports;
DROP POLICY IF EXISTS "User View Own Report" ON public.damage_reports;
DROP POLICY IF EXISTS "Admin Manage Reports" ON public.damage_reports;

CREATE POLICY "User Create Report" ON public.damage_reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User View Own Report" ON public.damage_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admin Manage Reports" ON public.damage_reports FOR ALL USING (public.is_admin());

ALTER TABLE public.game_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User Create Request" ON public.game_requests;
DROP POLICY IF EXISTS "User View Own Request" ON public.game_requests;
DROP POLICY IF EXISTS "Admin Manage Requests" ON public.game_requests;

CREATE POLICY "User Create Request" ON public.game_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User View Own Request" ON public.game_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admin Manage Requests" ON public.game_requests FOR ALL USING (public.is_admin());

SELECT 'All Tables Secured with RLS (Fixed)' as status;
