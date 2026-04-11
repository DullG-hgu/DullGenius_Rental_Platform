-- [Fix] user_roles RLS 정책 수정
-- 관리자가 모든 사용자의 역할을 조회할 수 있도록 'select' 정책을 허용합니다.

-- 기존 정책 확인 (선택 사항)
-- SELECT * FROM pg_policies WHERE tablename = 'user_roles';

-- 1. 기존 정책이 있다면 삭제 (충돌 방지)
DROP POLICY IF EXISTS "Allow read access for all users" ON public.user_roles;
DROP POLICY IF EXISTS "Enable read access for own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.user_roles;

-- 2. 새 정책 추가: "로그인한 사용자는 모든 역할을 조회 가능"
-- (보안을 더 강화하려면 admin 역할만 조회 가능하게 해야 하지만, 
--  현재 구조상 admin 역할을 확인하려면 user_roles를 읽어야 하는 딜레마가 있어 일단 인증된 전체 유저 허용으로 풉니다)
CREATE POLICY "Allow read access for authenticated users"
ON public.user_roles
FOR SELECT
USING (auth.role() = 'authenticated');

-- 3. (확인) RLS 활성화 확인
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. 확인용 쿼리
SELECT * FROM public.user_roles LIMIT 5;
