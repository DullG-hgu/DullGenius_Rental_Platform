-- [Force Fix RLS] 권한 문제 완전 해결
-- 대여 기록(rentals) 및 프로필(profiles) 조회 권한을 확실하게 엽니다.

-- 1. Rentals 테이블 정책 초기화 (모두 삭제 후 재생성)
DROP POLICY IF EXISTS "View Own Rentals" ON public.rentals;
DROP POLICY IF EXISTS "View own rentals" ON public.rentals;
DROP POLICY IF EXISTS "Select Own Rentals" ON public.rentals;
DROP POLICY IF EXISTS "View All Rentals" ON public.rentals; -- 기존것 삭제 후 다시 깨끗하게

-- 2. Rentals 새 정책: 누구나 모든 대여 기록 조회 가능
CREATE POLICY "View All Rentals"
ON public.rentals
FOR SELECT
TO public
USING (true);

-- 3. Profiles 테이블 정책 점검 (관리자가 유저 이름 조회 가능해야 함)
-- 기존 정책이 제한적일 수 있으므로, 조회(SELECT)는 모두에게 허용
DROP POLICY IF EXISTS "Public Profiles" ON public.profiles;
DROP POLICY IF EXISTS "View Profiles" ON public.profiles;

CREATE POLICY "Public Profiles"
ON public.profiles
FOR SELECT
TO public
USING (true);

-- 4. Game Copies 테이블 (혹시 몰라 명시)
DROP POLICY IF EXISTS "View Copies" ON public.game_copies;
CREATE POLICY "View Copies"
ON public.game_copies
FOR SELECT
TO public
USING (true);

-- 5. 권한 재부여 (Grant) - 혹시 모를 권한 누락 방지
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rentals TO service_role;
GRANT SELECT ON public.rentals TO anon, authenticated;

-- 완료 메시지 (선택)
-- SELECT 'RLS Fix Completed' as result;
