-- [Fix RLS] 대여 기록 조회 권한 확대
-- 기존: 본인 기록만 조회 가능 (auth.uid() = user_id)
-- 변경: 누구나(또는 로그인한 사용자) 모든 대여 기록 조회 가능 (관리자 대시보드 및 게임 목록 표시용)

-- 1. 기존 SELECT 정책 삭제 (중복 포함)
DROP POLICY IF EXISTS "View Own Rentals" ON public.rentals;
DROP POLICY IF EXISTS "View own rentals" ON public.rentals;
DROP POLICY IF EXISTS "Select Own Rentals" ON public.rentals;

-- 2. 새 SELECT 정책 추가 (모든 인증된 사용자 조회 허용)
-- 조건: true (제한 없음) -> 관리자가 누구의 대여 기록이든 볼 수 있어야 하므로.
CREATE POLICY "View All Rentals"
ON public.rentals
FOR SELECT
TO public
USING (true);

-- 3. INSERT/UPDATE는 기존 유지 (또는 필요시 수정)
-- RPC(admin_rent_copy)는 Security Definer이므로 RLS 무시하고 INSERT 가능함.
-- 따라서 View 정책만 풀면 됨.
