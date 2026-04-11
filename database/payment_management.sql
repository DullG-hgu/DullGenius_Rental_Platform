-- ========================================
-- 회비 관리 시스템 (Payment Management)
-- ========================================

-- 1. app_config에 payment_check_enabled 설정 추가
INSERT INTO public.app_config (key, value)
VALUES ('payment_check_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- 2. payment_exempt 역할 추가 (이미 있다면 무시)
INSERT INTO public.roles (role_key, display_name, permissions)
VALUES ('payment_exempt', '회비 면제', jsonb_build_object('can_rent_without_payment', true))
ON CONFLICT (role_key) DO NOTHING;

-- 3. 학기 종료 시 회비 상태 일괄 초기화 함수
CREATE OR REPLACE FUNCTION public.reset_semester_payments()
RETURNS jsonb AS $$
DECLARE
    v_reset_count INTEGER;
BEGIN
    -- 영구 면제 역할을 가진 사용자 제외하고 모든 회원의 is_paid를 false로 설정
    UPDATE public.profiles
    SET is_paid = false
    WHERE id NOT IN (
        SELECT user_id 
        FROM public.user_roles 
        WHERE role_key IN ('admin', 'executive', 'payment_exempt')
    );
    
    GET DIAGNOSTICS v_reset_count = ROW_COUNT;
    
    -- 로그 기록
    INSERT INTO public.logs (action_type, details)
    VALUES ('SEMESTER_RESET', jsonb_build_object('message', '학기 초기화', 'reset_count', v_reset_count));
    
    RETURN jsonb_build_object(
        'success', true, 
        'reset_count', v_reset_count,
        'message', v_reset_count || '명의 회비 상태가 초기화되었습니다.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 회비 검사 활성화 여부 조회 헬퍼 함수
CREATE OR REPLACE FUNCTION public.is_payment_check_enabled()
RETURNS boolean AS $$
DECLARE
    v_enabled TEXT;
BEGIN
    SELECT value INTO v_enabled
    FROM public.app_config
    WHERE key = 'payment_check_enabled';
    
    -- 기본값은 true (설정이 없으면 검사 활성화)
    RETURN COALESCE(v_enabled = 'true', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 사용자 회비 면제 여부 확인 헬퍼 함수
CREATE OR REPLACE FUNCTION public.is_user_payment_exempt(p_user_id UUID)
RETURNS boolean AS $$
BEGIN
    -- admin, executive, payment_exempt 역할 중 하나라도 있으면 면제
    RETURN EXISTS (
        SELECT 1 
        FROM public.user_roles 
        WHERE user_id = p_user_id 
          AND role_key IN ('admin', 'executive', 'payment_exempt')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
