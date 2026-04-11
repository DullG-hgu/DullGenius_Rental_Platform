-- ============================================================
-- [정석 해결] user_roles 테이블 외래 키(Foreign Key) 설정
-- ============================================================
-- 목적: user_roles 테이블이 profiles 테이블을 명확하게 참조하도록 설정하여
--       Supabase/PostgREST가 자동으로 JOIN 관계를 인식하도록 함.
-- ============================================================

-- 1. 기존 제약 조건 확인 및 삭제 (충돌 방지)
-- (만약 이름이 다르다면 에러가 날 수 있으므로 IF EXISTS 사용)
DO $$ 
BEGIN
    -- fk_user_roles_profiles 제약 조건이 있으면 삭제
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_roles_profiles') THEN
        ALTER TABLE public.user_roles DROP CONSTRAINT fk_user_roles_profiles;
    END IF;
END $$;

-- 2. 외래 키 제약 조건 추가
-- user_roles.user_id가 public.profiles.id를 참조하도록 설정
ALTER TABLE public.user_roles
ADD CONSTRAINT fk_user_roles_profiles
FOREIGN KEY (user_id)
REFERENCES public.profiles(id)
ON DELETE CASCADE; -- 사용자가 삭제되면 역할 정보도 자동 삭제

-- 3. 관계 설명 주석 (PostgREST가 관계를 더 잘 인식하도록 돕습니다)
COMMENT ON CONSTRAINT fk_user_roles_profiles ON public.user_roles IS 
'Connects user roles to user profiles for easy joining.';

-- 4. 확인 메시지
SELECT '✅ user_roles 테이블에 외래 키(FK)가 성공적으로 설정되었습니다. 이제 API에서 JOIN 쿼리가 정상 작동합니다.' as result;
