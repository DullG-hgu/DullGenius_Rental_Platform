-- ============================================================
-- [RPC] 비밀번호 자가 재설정 (이메일 수신 불가 대응용)
-- ============================================================
-- 본인의 학번, 이름, 전화번호가 일치할 경우에만 비밀번호를 변경합니다.

CREATE OR REPLACE FUNCTION public.reset_own_password(
    p_student_id TEXT,
    p_name TEXT,
    p_phone TEXT,
    p_new_password TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER -- 관리자 권한으로 실행 (auth.users 업데이트를 위해)
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_user_id UUID;
    v_target_email TEXT;
BEGIN
    -- 1. 프로필 정보 대조 (학번, 이름, 전화번호 일치 여부 확인)
    SELECT id INTO v_user_id
    FROM public.profiles
    WHERE student_id = p_student_id 
      AND name = p_name 
      AND phone = p_phone;

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '입력하신 정보와 일치하는 회원을 찾을 수 없습니다.');
    END IF;

    -- 2. 해당 유저의 이메일 확인
    SELECT email INTO v_target_email FROM auth.users WHERE id = v_user_id;

    -- 3. 비밀번호 업데이트 (bcrypt 해시 생성을 위해 crypt 함수 사용)
    UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
        updated_at = now()
    WHERE id = v_user_id;

    -- 4. 로그 기록
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (
        NULL, 
        v_user_id, 
        'SELF_RESET_PW', 
        jsonb_build_object(
            'description', '사용자가 정보를 대조하여 비밀번호를 직접 재설정함'
        )
    );

    RETURN jsonb_build_object('success', true, 'message', '비밀번호가 성공적으로 변경되었습니다.');

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '오류 발생: ' || SQLERRM);
END;
$$;

-- 보안 설정: anon도 접근 가능해야 로그인이 안 된 상태에서 사용 가능
GRANT EXECUTE ON FUNCTION public.reset_own_password(TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.reset_own_password(TEXT, TEXT, TEXT, TEXT) TO authenticated;
