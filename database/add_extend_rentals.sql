-- ========================================
-- [NEW] 기간 연장 기능 프로시저 (24시 마감 고정)
-- 대상 대여건(RENT)의 만료 기한을 주어진 일수(N일)만큼 연장하고,
-- 항상 해당 일자의 23시 59분 59초로 마감되도록 고정합니다.
-- 로그에는 'EXTEND' 액션으로 기록합니다.
-- ========================================

CREATE OR REPLACE FUNCTION public.admin_extend_rentals(
    p_user_id UUID DEFAULT NULL,
    p_renter_name TEXT DEFAULT NULL,
    p_game_id INTEGER DEFAULT NULL,
    p_rental_id UUID DEFAULT NULL,
    p_days INTEGER DEFAULT 7
) RETURNS jsonb AS $$
DECLARE
    v_new_due_date TIMESTAMP WITH TIME ZONE;
    r RECORD;
    v_count INTEGER := 0;
BEGIN
    -- [안전장치 1] 타 렌탈 건 침해 방지: 조건이 모두 NULL이면 전체 업데이트 위험이 있으므로 즉시 차단
    IF p_user_id IS NULL AND p_renter_name IS NULL AND p_game_id IS NULL AND p_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '연장 대상을 특정할 수 없습니다. (모든 식별자가 비어있음)');
    END IF;

    -- 현재 시간의 날짜(자정 00:00:00) 기준으로 N일을 더한 뒤, 23시간 59분 59초를 더해 해당일 밤 12시 세팅
    v_new_due_date := date_trunc('day', now()) + (p_days || ' days')::interval + interval '23 hours 59 minutes 59 seconds';

    FOR r IN 
        SELECT rental_id, game_id, user_id, renter_name 
        FROM public.rentals
        WHERE type = 'RENT' 
          AND returned_at IS NULL
          AND (p_rental_id IS NULL OR rental_id = p_rental_id)
          AND (p_game_id IS NULL OR game_id = p_game_id)
          -- [안전장치 2] user_id와 renter_name 조건 최적화
          -- user_id가 있으면 user_id만 확실하게 매칭하고, 없으면 renter_name 매칭으로 우회하여 동명이나 권한 겹침 오류 최소화
          AND (
              (p_user_id IS NOT NULL AND user_id = p_user_id) OR
              (p_user_id IS NULL AND p_renter_name IS NOT NULL AND renter_name = p_renter_name) OR
              (p_user_id IS NULL AND p_renter_name IS NULL)
          )
    LOOP
        -- 기한 수정
        UPDATE public.rentals SET due_date = v_new_due_date WHERE rental_id = r.rental_id;
        
        -- 연장 로그 기록 추가
        INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (r.game_id, r.user_id, 'EXTEND', jsonb_build_object('message', COALESCE(p_days, 7) || '일 기한 연장', 'days', p_days, 'new_due_date', v_new_due_date, 'renter', COALESCE(r.renter_name, 'Unknown')));
        
        v_count := v_count + 1;
    END LOOP;
    
    IF v_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '조건에 맞는 연장할 활성 대여 건이 없습니다. 이미 반납되었거나 대상을 찾을 수 없습니다.');
    END IF;
    
    RETURN jsonb_build_object('success', true, 'message', v_count || '건 연장 처리 완료', 'new_due_date', v_new_due_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
