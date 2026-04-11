-- ============================================================
-- [User Roles 관리 헬퍼 스크립트]
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================
-- 이 스크립트는 user_roles 테이블의 UUID를 사람이 읽을 수 있는
-- 형태(이메일, 이름, 학번)로 조회하고 수정하는 기능을 제공합니다.
-- ============================================================

-- ============================================================
-- 1. VIEW 생성: 사용자 역할을 읽기 쉬운 형태로 조회
-- ============================================================
CREATE OR REPLACE VIEW user_roles_view AS
SELECT 
    ur.user_id,
    au.email,
    p.name,
    p.student_id,
    ur.role_key,
    ur.assigned_at
FROM 
    public.user_roles ur
    JOIN auth.users au ON ur.user_id = au.id
    LEFT JOIN public.profiles p ON ur.user_id = p.id
ORDER BY 
    ur.assigned_at DESC;

-- ============================================================
-- 2. 함수: 이메일로 역할 추가
-- ============================================================
CREATE OR REPLACE FUNCTION add_role_by_email(
    p_email text,
    p_role_key text DEFAULT 'admin'
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id uuid;
    v_name text;
BEGIN
    -- 이메일로 사용자 ID 찾기
    SELECT au.id, p.name 
    INTO v_user_id, v_name
    FROM auth.users au
    LEFT JOIN public.profiles p ON au.id = p.id
    WHERE au.email = p_email;

    -- 사용자가 없으면 에러
    IF v_user_id IS NULL THEN
        RETURN '❌ 사용자를 찾을 수 없습니다: ' || p_email;
    END IF;

    -- 역할 추가 (이미 있으면 무시)
    INSERT INTO public.user_roles (user_id, role_key)
    VALUES (v_user_id, p_role_key)
    ON CONFLICT (user_id, role_key) DO NOTHING;

    RETURN '✅ ' || COALESCE(v_name, p_email) || ' 님에게 "' || p_role_key || '" 역할이 부여되었습니다.';
END;
$$;

-- ============================================================
-- 3. 함수: 이메일로 역할 제거
-- ============================================================
CREATE OR REPLACE FUNCTION remove_role_by_email(
    p_email text,
    p_role_key text DEFAULT 'admin'
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id uuid;
    v_name text;
    v_deleted_count int;
BEGIN
    -- 이메일로 사용자 ID 찾기
    SELECT au.id, p.name 
    INTO v_user_id, v_name
    FROM auth.users au
    LEFT JOIN public.profiles p ON au.id = p.id
    WHERE au.email = p_email;

    -- 사용자가 없으면 에러
    IF v_user_id IS NULL THEN
        RETURN '❌ 사용자를 찾을 수 없습니다: ' || p_email;
    END IF;

    -- 역할 제거
    DELETE FROM public.user_roles
    WHERE user_id = v_user_id AND role_key = p_role_key;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    IF v_deleted_count > 0 THEN
        RETURN '✅ ' || COALESCE(v_name, p_email) || ' 님의 "' || p_role_key || '" 역할이 제거되었습니다.';
    ELSE
        RETURN '⚠️ ' || COALESCE(v_name, p_email) || ' 님은 "' || p_role_key || '" 역할을 가지고 있지 않습니다.';
    END IF;
END;
$$;

-- ============================================================
-- 4. 함수: 학번으로 역할 추가
-- ============================================================
CREATE OR REPLACE FUNCTION add_role_by_student_id(
    p_student_id text,
    p_role_key text DEFAULT 'admin'
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id uuid;
    v_name text;
BEGIN
    -- 학번으로 사용자 ID 찾기
    SELECT id, name 
    INTO v_user_id, v_name
    FROM public.profiles
    WHERE student_id = p_student_id;

    -- 사용자가 없으면 에러
    IF v_user_id IS NULL THEN
        RETURN '❌ 사용자를 찾을 수 없습니다: ' || p_student_id;
    END IF;

    -- 역할 추가 (이미 있으면 무시)
    INSERT INTO public.user_roles (user_id, role_key)
    VALUES (v_user_id, p_role_key)
    ON CONFLICT (user_id, role_key) DO NOTHING;

    RETURN '✅ ' || v_name || ' (' || p_student_id || ') 님에게 "' || p_role_key || '" 역할이 부여되었습니다.';
END;
$$;

-- ============================================================
-- 사용 예제
-- ============================================================

-- [예제 1] 현재 모든 관리자 및 운영진 확인
-- SELECT * FROM user_roles_view WHERE role_key IN ('admin', 'executive');

-- [예제 2] 특정 사용자의 모든 역할 확인
-- SELECT * FROM user_roles_view WHERE email = 'user@example.com';

-- [예제 3] 이메일로 관리자 권한 부여
-- SELECT add_role_by_email('user@example.com', 'admin');

-- [예제 4] 학번으로 관리자 권한 부여
-- SELECT add_role_by_student_id('22200084', 'admin');

-- [예제 5] 이메일로 관리자 권한 제거
-- SELECT remove_role_by_email('user@example.com', 'admin');

-- [예제 6] 모든 사용자와 역할 확인 (역할이 없는 사용자 포함)
-- SELECT 
--     au.email,
--     p.name,
--     p.student_id,
--     COALESCE(STRING_AGG(ur.role_key, ', '), '없음') as roles
-- FROM 
--     auth.users au
--     LEFT JOIN public.profiles p ON au.id = p.id
--     LEFT JOIN public.user_roles ur ON au.id = ur.user_id
-- GROUP BY 
--     au.email, p.name, p.student_id
-- ORDER BY 
--     p.name;

-- ============================================================
-- 완료 메시지
-- ============================================================
SELECT '✅ User Roles 관리 헬퍼가 설치되었습니다!' as status;
