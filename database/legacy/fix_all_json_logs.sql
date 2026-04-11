-- ============================================================
-- [JSONB Compatibility Fix] 모든 로그 삽입 RPC 함수 일괄 업데이트
-- details 컬럼이 JSONB로 변경됨에 따라 to_jsonb()를 사용하여 삽입
-- ============================================================

-- 1. core_functions_v2.sql 기반 함수들 수정
CREATE OR REPLACE FUNCTION public.dibs_game(
    p_game_id INTEGER,
    p_user_id UUID
) RETURNS jsonb AS $$
DECLARE
    v_available INTEGER;
    v_game_name TEXT;
BEGIN
    SELECT name, available_count INTO v_game_name, v_available
    FROM public.games WHERE id = p_game_id;
    
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;
    IF v_available <= 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM public.rentals 
        WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'DIBS' AND returned_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 찜한 게임입니다.');
    END IF;
    
    IF is_payment_check_enabled() AND NOT is_user_payment_exempt(p_user_id) THEN
        IF NOT COALESCE((SELECT is_paid FROM public.profiles WHERE id = p_user_id), false) THEN
            RETURN jsonb_build_object('success', false, 'message', '회비를 납부해야 대여할 수 있습니다.');
        END IF;
    END IF;
    
    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date)
    VALUES (p_game_id, p_user_id, v_game_name, 'DIBS', now(), now() + interval '30 minutes');
    
    UPDATE public.games SET available_count = available_count - 1 WHERE id = p_game_id;
    
    -- [FIX] to_jsonb() 추가
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'DIBS', to_jsonb('User reserved game'::text));
    
    RETURN jsonb_build_object('success', true, 'message', '찜 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.rent_game(
    p_game_id INTEGER,
    p_user_id UUID,
    p_renter_name TEXT
) RETURNS jsonb AS $$
DECLARE
    v_game_name TEXT;
BEGIN
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;
    
    UPDATE public.rentals SET returned_at = now()
    WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'DIBS' AND returned_at IS NULL;
    
    INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date)
    VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days');
    
    -- [FIX] to_jsonb() 추가
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('User rented game: ' || p_renter_name));
    
    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.return_game(
    p_game_id INTEGER,
    p_user_id UUID
) RETURNS jsonb AS $$
BEGIN
    UPDATE public.rentals SET returned_at = now()
    WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'RENT' AND returned_at IS NULL;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 내역이 없습니다.');
    END IF;
    
    UPDATE public.games SET available_count = available_count + 1 WHERE id = p_game_id;
    
    -- [FIX] to_jsonb() 추가
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RETURN', to_jsonb('User returned game'::text));
    
    RETURN jsonb_build_object('success', true, 'message', '반납 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_rent_game(
    p_game_id INTEGER,
    p_renter_name TEXT,
    p_user_id UUID DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_game_name TEXT;
    v_available INTEGER;
BEGIN
    SELECT name, available_count INTO v_game_name, v_available FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;
    
    UPDATE public.rentals SET returned_at = now()
    WHERE game_id = p_game_id AND (user_id = p_user_id OR renter_name = p_renter_name) AND type = 'DIBS' AND returned_at IS NULL;
    
    IF NOT FOUND THEN
        IF v_available <= 0 THEN
            RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
        END IF;
        UPDATE public.games SET available_count = available_count - 1 WHERE id = p_game_id;
    END IF;
    
    INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date)
    VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days');
    
    -- [FIX] to_jsonb() 추가
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('ADMIN: ' || p_renter_name));
    
    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_return_game(
    p_game_id INTEGER,
    p_renter_name TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_affected INTEGER;
BEGIN
    UPDATE public.rentals SET returned_at = now()
    WHERE game_id = p_game_id 
      AND ((p_user_id IS NOT NULL AND user_id = p_user_id) OR (p_renter_name IS NOT NULL AND renter_name = p_renter_name) OR (p_user_id IS NULL AND p_renter_name IS NULL))
      AND returned_at IS NULL;
    
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '대여/찜 내역이 없습니다.');
    END IF;
    
    UPDATE public.games SET available_count = available_count + v_affected WHERE id = p_game_id;
    
    -- [FIX] to_jsonb() 추가
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RETURN', to_jsonb('ADMIN: ' || COALESCE(p_renter_name, 'Unknown')));
    
    RETURN jsonb_build_object('success', true, 'message', v_affected || '건 반납 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. harden_core_logic.sql 기반 함수 수정
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
    IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;
    SELECT name, available_count INTO v_game_name, v_available FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;
    v_due_date := (timezone('kst', now()) + interval '1 day') + time '23:59:59';

    UPDATE public.rentals SET type = 'RENT', borrowed_at = timezone('kst', now()), due_date = v_due_date, returned_at = NULL
    WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'DIBS' AND returned_at IS NULL
    RETURNING rental_id INTO v_rental_id;

    IF v_rental_id IS NOT NULL THEN
        -- [FIX] to_jsonb() 추가
        INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('DIBS -> RENT Conversion'::text));
        RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
    END IF;

    IF v_available <= 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 가능한 재고가 없습니다.');
    END IF;
    UPDATE public.games SET available_count = available_count - 1 WHERE id = p_game_id;

    INSERT INTO public.rentals (user_id, game_id, game_name, borrowed_at, due_date, type)
    VALUES (p_user_id, p_game_id, v_game_name, timezone('kst', now()), v_due_date, 'RENT')
    RETURNING rental_id INTO v_rental_id;

    -- [FIX] to_jsonb() 추가
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('Direct Rental'::text));
    RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. kiosk_pickup.sql 기반 함수 수정
CREATE OR REPLACE FUNCTION kiosk_pickup(
    p_rental_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_game_id INTEGER;
    v_user_id UUID;
    v_status TEXT;
BEGIN
    SELECT game_id, user_id, type INTO v_game_id, v_user_id, v_status FROM rentals WHERE rental_id = p_rental_id;
    IF v_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 예약입니다.');
    END IF;
    IF v_status != 'DIBS' THEN
        RETURN jsonb_build_object('success', false, 'message', '예약(찜) 상태가 아닙니다.');
    END IF;

    UPDATE rentals SET type = 'RENT', borrowed_at = timezone('kst', now()), due_date = timezone('kst', now() + INTERVAL '2 days')
    WHERE rental_id = p_rental_id;

    -- [FIX] to_jsonb() 추가
    INSERT INTO logs (game_id, user_id, action_type, details)
    VALUES (v_game_id, v_user_id, 'RENT', to_jsonb('Kiosk Pickup (Rental ID: ' || p_rental_id || ')'));

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. payment_management.sql 기반 함수 수정
CREATE OR REPLACE FUNCTION public.reset_semester_payments()
RETURNS jsonb AS $$
DECLARE
    v_reset_count INTEGER;
BEGIN
    UPDATE public.profiles SET is_paid = false
    WHERE id NOT IN (SELECT user_id FROM public.user_roles WHERE role_key IN ('admin', 'executive', 'payment_exempt'));
    
    GET DIAGNOSTICS v_reset_count = ROW_COUNT;
    
    -- [FIX] to_jsonb() 추가
    INSERT INTO public.logs (action_type, details)
    VALUES ('SEMESTER_RESET', to_jsonb('학기 초기화: ' || v_reset_count || '명의 회비 상태 초기화'));
    
    RETURN jsonb_build_object('success', true, 'reset_count', v_reset_count, 'message', v_reset_count || '명의 회비 상태가 초기화되었습니다.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
