-- ============================================================
-- [특정 사용자에게 관리자 권한 부여]
-- 사용자 ID: ee24c496-ac06-40bb-ac09-9aebb4277526
-- ============================================================

-- 1. 현재 사용자 정보 확인 (선택사항)
SELECT 
    au.id,
    au.email,
    p.name,
    p.student_id
FROM 
    auth.users au
    LEFT JOIN public.profiles p ON au.id = p.id
WHERE 
    au.id = 'ee24c496-ac06-40bb-ac09-9aebb4277526';

-- 2. 관리자 권한 추가 (핵심!)
INSERT INTO public.user_roles (user_id, role_key)
VALUES ('ee24c496-ac06-40bb-ac09-9aebb4277526', 'admin')
ON CONFLICT (user_id, role_key) DO NOTHING;

-- 3. 권한 부여 확인
SELECT 
    au.email,
    p.name,
    p.student_id,
    ur.role_key,
    ur.assigned_at
FROM 
    public.user_roles ur
    JOIN auth.users au ON ur.user_id = au.id
    LEFT JOIN public.profiles p ON ur.user_id = p.id
WHERE 
    ur.user_id = 'ee24c496-ac06-40bb-ac09-9aebb4277526';

-- ============================================================
-- 완료 메시지
-- ============================================================
SELECT '✅ 관리자 권한이 부여되었습니다!' as status;
