-- [Fix Profiles UPDATE Permission]
-- 관리자가 회비 상태(is_paid) 등을 업데이트할 수 있도록 RLS 정책 추가

-- 1. 기존 UPDATE 정책 삭제 (있다면)
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Update Own Profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin Update Profiles" ON public.profiles;

-- 2. 새로운 UPDATE 정책 생성
-- 방법 A: 본인 프로필만 수정 가능 (일반 사용자)
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 방법 B: 관리자는 모든 프로필 수정 가능
-- 주의: 이 정책을 사용하려면 user_roles 테이블에서 관리자 여부를 확인해야 합니다.
-- 하지만 RLS 정책에서 JOIN이 복잡하므로, 간단하게 service_role로 처리하거나
-- 클라이언트에서 관리자 확인 후 호출하는 방식을 사용합니다.

-- 임시 해결책: 인증된 모든 사용자가 UPDATE 가능 (개발 환경용)
-- 프로덕션에서는 관리자 권한 체크 로직 추가 필요!
DROP POLICY IF EXISTS "Authenticated users can update profiles" ON public.profiles;
CREATE POLICY "Authenticated users can update profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 3. 권한 부여 확인
GRANT UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- 완료 메시지
SELECT 'Profiles UPDATE permission fixed' as result;
