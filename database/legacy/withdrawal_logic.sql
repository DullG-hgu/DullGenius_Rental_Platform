-- ==========================================
-- 👤 회원 탈퇴 (Withdrawal) 로직 - 최종 강화형
-- ==========================================

CREATE OR REPLACE FUNCTION public.withdraw_user(
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_active_rentals_count integer;
    v_active_dibs_count integer;
    v_penalty_count integer;
BEGIN
    -- 1. 본인 확인 (Security Check)
    IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    -- 2. 미반납 대여 확인
    SELECT count(*) INTO v_active_rentals_count
    FROM public.rentals
    WHERE user_id = p_user_id 
      AND type = 'RENT' 
      AND returned_at IS NULL;

    IF v_active_rentals_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '반납하지 않은 게임이 있습니다. 모든 게임을 반납한 후 탈퇴할 수 있습니다.');
    END IF;

    -- 3. 유효한 찜 확인
    SELECT count(*) INTO v_active_dibs_count
    FROM public.rentals
    WHERE user_id = p_user_id 
      AND type = 'DIBS' 
      AND returned_at IS NULL
      AND due_date > now();

    IF v_active_dibs_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '현재 찜(예약) 중인 게임이 있습니다. 찜을 취소한 뒤 탈퇴해 주세요.');
    END IF;

    -- 4. [NEW] 연체/패널티 확인 (탈퇴를 통한 벌점 세탁 방지)
    SELECT penalty INTO v_penalty_count
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_penalty_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '현재 해결되지 않은 연체/패널티 기록(' || v_penalty_count || '건)이 있습니다. 관리자에게 문의하여 해결 후 탈퇴할 수 있습니다.');
    END IF;

    -- 5. 데이터 영구 삭제 (개인정보 보호를 위해 정보 삭제)
    -- 5-1. 포인트 내역 및 역할 정보 삭제
    DELETE FROM public.point_transactions WHERE user_id = p_user_id;
    DELETE FROM public.user_roles WHERE user_id = p_user_id;

    -- 5-2. 리뷰/대여/로그 작성자 익명화 (통계용)
    UPDATE public.reviews SET user_id = NULL, author_name = '탈퇴 회원' WHERE user_id = p_user_id;
    UPDATE public.rentals SET user_id = NULL, renter_name = '탈퇴 회원' WHERE user_id = p_user_id;
    UPDATE public.logs SET user_id = NULL WHERE user_id = p_user_id;

    -- 5-3. 프로필 영구 삭제
    DELETE FROM public.profiles WHERE id = p_user_id;

    RETURN jsonb_build_object('success', true, 'message', '회원 탈퇴 및 모든 개인 정보가 삭제되었습니다. 이용해 주셔서 감사합니다.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
