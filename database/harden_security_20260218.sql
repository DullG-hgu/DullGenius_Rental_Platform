-- [SECURITY] Harden RLS Policies (2026-02-18)
-- 이 스크립트는 Supabase Security Advisor 경고를 해결하기 위해
-- User Data를 보호하는 강력한 RLS 정책을 적용합니다.

-- ============================================================
-- 1. Matches (매치 기록) - RLS 활성화
-- ============================================================
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User View Own Matches" ON public.matches;
DROP POLICY IF EXISTS "Admin Manage Matches" ON public.matches;

-- 내 매치 기록만 조회 가능 (players 배열에 내 ID가 있거나, 승자 ID가 나인 경우)
-- players 컬럼은 JSONB (["uuid", "uuid"]) 형태임.
CREATE POLICY "User View Own Matches" ON public.matches 
FOR SELECT USING (
  (players @> to_jsonb(auth.uid())) OR (winner_id = auth.uid()) OR (public.is_admin())
);

-- 관리자는 모든 권한
CREATE POLICY "Admin Manage Matches" ON public.matches 
FOR ALL USING (public.is_admin());


-- ============================================================
-- 2. Profiles (프로필) - 공개 접근 차단
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 기존의 "모두 공개" 정책 삭제 (보안 취약점)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- 안전한 정책 재확인 (이미 존재하겠지만 확실히 하기 위해)
DROP POLICY IF EXISTS "Read Own Profile" ON public.profiles;
DROP POLICY IF EXISTS "Update Own Profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin Manage Profiles" ON public.profiles;

CREATE POLICY "Read Own Profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Update Own Profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin Manage Profiles" ON public.profiles FOR ALL USING (public.is_admin());


-- ============================================================
-- 3. Point Transactions (포인트 내역) - 공개 접근 차단
-- ============================================================
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Point logs are viewable by everyone" ON public.point_transactions;

-- 안전한 정책 적용
DROP POLICY IF EXISTS "View Own Points" ON public.point_transactions;
DROP POLICY IF EXISTS "Admin Manage Points" ON public.point_transactions;

CREATE POLICY "View Own Points" ON public.point_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admin Manage Points" ON public.point_transactions FOR ALL USING (public.is_admin());


-- ============================================================
-- 4. Rentals (대여 기록) - 공개 접근 차단 (익명성 보장)
-- ============================================================
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;

-- 기존 "모두 공개" 정책 삭제
DROP POLICY IF EXISTS "Public Read Rentals" ON public.rentals;

-- 안전한 정책 적용
DROP POLICY IF EXISTS "User View Own Rentals" ON public.rentals;
DROP POLICY IF EXISTS "Admin Manage Rentals" ON public.rentals;

-- 나는 내 대여 기록만 볼 수 있음
CREATE POLICY "User View Own Rentals" ON public.rentals FOR SELECT USING (auth.uid() = user_id);

-- 관리자는 모든 대여 기록 관리 가능
CREATE POLICY "Admin Manage Rentals" ON public.rentals FOR ALL USING (public.is_admin());


-- ============================================================
-- 5. 마무리 확인
-- ============================================================
SELECT 'Security Hardening Completed: Matches, Profiles, Points, Rentals Secured.' as status;
