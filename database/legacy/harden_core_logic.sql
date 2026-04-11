-- harden_core_logic.sql (V2 Update)
-- 기존 copy 기반 로직을 game_id 기반(available_count)으로 변경

-- 1. [Security] rent_any_copy: 본인 대여 (api.jsx에서 사용)
-- V2: copy_id 선택 없이 game_id로 바로 대여 혹은 찜 전환
CREATE OR REPLACE FUNCTION public.rent_any_copy(
    p_game_id integer,
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_game_name text;
    v_rental_id uuid;
    v_due_date timestamptz;
    v_available integer;
BEGIN
    -- [SEC] 본인 확인
    IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    SELECT name, available_count INTO v_game_name, v_available 
    FROM public.games WHERE id = p_game_id;

    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;

    v_due_date := (timezone('kst', now()) + interval '1 day') + time '23:59:59'; -- 다음날 23:59:59

    -- 1. 본인 찜 확인 (DIBS -> RENT 전환)
    -- V2: 찜할 때 이미 재고 차감됨. 따라서 반납 없이 type만 변경.
    UPDATE public.rentals
    SET 
        type = 'RENT',
        borrowed_at = timezone('kst', now()),
        due_date = v_due_date,
        returned_at = NULL -- 혹시라도 설정되어 있다면 초기화
    WHERE game_id = p_game_id 
      AND user_id = p_user_id 
      AND type = 'DIBS' 
      AND returned_at IS NULL
    RETURNING rental_id INTO v_rental_id;

    IF v_rental_id IS NOT NULL THEN
        -- 찜 전환 성공 (로그 불필요? 찜할때 이미 남김. 하지만 대여 시점 기록 위해 남김)
        INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('message', 'DIBS -> RENT Conversion'));
        
        RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
    END IF;

    -- 2. 찜 안했으면 -> 가용 재고 확인 후 대여
    IF v_available <= 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 가능한 재고가 없습니다.');
    END IF;

    -- 재고 차감
    UPDATE public.games 
    SET available_count = available_count - 1 
    WHERE id = p_game_id;

    -- 대여 기록 생성
    INSERT INTO public.rentals (user_id, game_id, game_name, borrowed_at, due_date, type)
    VALUES (p_user_id, p_game_id, v_game_name, timezone('kst', now()), v_due_date, 'RENT')
    RETURNING rental_id INTO v_rental_id;

    -- 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('message', 'Direct Rental'));

    RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. [Safety] 안전 삭제 (api.jsx에서 사용)
-- V2: game_copies 테이블 없음. rentals 테이블의 활성 대여 확인.
CREATE OR REPLACE FUNCTION public.safe_delete_game(
    p_game_id integer
) RETURNS jsonb AS $$
DECLARE
    v_active_count integer;
BEGIN
    -- 활성 대여/찜 확인 (returned_at IS NULL)
    SELECT count(*) INTO v_active_count
    FROM public.rentals
    WHERE game_id = p_game_id 
      AND returned_at IS NULL;

    IF v_active_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '대여/찜 중인 내역이 있어 삭제할 수 없습니다. (먼저 반납 처리하세요)');
    END IF;

    -- 게임 삭제 (Cascade로 관련 로그/완료된 대여는 자동 처리될 수 있음. 주의 필요)
    -- 보통 soft delete를 권장하지만 여기서는 hard delete 허용
    DELETE FROM public.games WHERE id = p_game_id;
    
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- [Deprecated] dibs_any_copy, admin_rent_copy 등은 core_functions_v2.sql의 함수들(dibs_game, admin_rent_game)로 대체되었습니다.
