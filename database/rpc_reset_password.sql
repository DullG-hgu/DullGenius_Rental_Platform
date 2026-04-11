-- ============================================================
-- [RPC] 비밀번호 강제 초기화 (관리자 전용) - PRO VERSION
-- ============================================================
-- 보안 강화 사항 (Security Hardening):
-- 1. search_path 강제 지정: 악의적인 스키마(함수) 하이재킹 방지
-- 2. 명확한 권한 체크: user_roles 테이블 조회
-- ============================================================

CREATE OR REPLACE FUNCTION public.reset_user_password(target_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER -- 관리자 권한으로 실행
SET search_path = public, auth, extensions -- [Security Fix] 스키마 경로 고정
AS $$
DECLARE
    v_operator_role text;
    v_target_email text;
    v_operator_id UUID;
BEGIN
    v_operator_id := auth.uid();

    -- 1. 권한 체크: 실행자가 관리자(admin)인지 확인
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = v_operator_id AND role_key = 'admin'
    ) THEN
        -- 보안 감사 로그: 권한 없는 시도 기록
        INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (NULL, v_operator_id, 'SECURITY_ALERT', jsonb_build_object('error', 'Unauthorized password reset attempt'));
        
        RETURN jsonb_build_object('success', false, 'message', '접근 권한이 없습니다.');
    END IF;

    -- 2. 대상 유저 존재 확인
    SELECT email INTO v_target_email FROM auth.users WHERE id = target_user_id;
    IF v_target_email IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 사용자입니다.');
    END IF;

    -- 3. 비밀번호 강제 업데이트 (12345678의 bcrypt 해시)
    UPDATE auth.users
    SET encrypted_password = crypt('12345678', gen_salt('bf')),
        updated_at = now()
    WHERE id = target_user_id;

    -- 4. 로그 기록
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (
        NULL, 
        v_operator_id, 
        'ADMIN_RESET_PW', 
        jsonb_build_object(
            'target_user_id', target_user_id, 
            'target_email', v_target_email,
            'description', '비밀번호를 12345678로 초기화함'
        )
    );

    RETURN jsonb_build_object('success', true, 'message', '비밀번호가 12345678로 초기화되었습니다.');

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '오류 발생: ' || SQLERRM);
END;
$$;

-- [Security Fix] 실행 권한 축소 (Least Privilege)
-- 익명 사용자(anon)의 실행 권한을 박탈하고, 로그인한 사용자(authenticated)에게만 허용합니다.
REVOKE EXECUTE ON FUNCTION public.reset_user_password(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.reset_user_password(UUID) TO authenticated;
