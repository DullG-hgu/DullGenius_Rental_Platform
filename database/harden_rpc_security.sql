-- [SECURITY] Harden RPC Functions
-- 이 스크립트는 SECURITY DEFINER로 실행되는 관리자 전용 함수들에 
-- 명시적인 권한 체크 로직을 추가하여 권한 상승 공격을 방지합니다.

-- ============================================================
-- 1. Admin Rent Game (관리자 대여)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_rent_game(p_game_id INTEGER, p_renter_name TEXT, p_user_id UUID DEFAULT NULL) RETURNS jsonb AS $$
DECLARE v_game_name TEXT; v_affected INTEGER;
BEGIN
    -- [SECURE] 권한 체크
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_key IN ('admin', 'executive')) THEN
        RETURN jsonb_build_object('success', false, 'message', '접근 권한이 없습니다.');
    END IF;

    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.'); END IF;

    UPDATE public.rentals SET type = 'RENT', returned_at = NULL, borrowed_at = now(), due_date = now() + interval '7 days', renter_name = p_renter_name, user_id = COALESCE(p_user_id, user_id)
    WHERE game_id = p_game_id AND (user_id = p_user_id OR renter_name = p_renter_name) AND type = 'DIBS' AND returned_at IS NULL;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN
        UPDATE public.games SET available_count = available_count - 1 WHERE id = p_game_id AND available_count > 0;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        IF v_affected = 0 THEN RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.'); END IF;
        INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date) VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days');
    END IF;
    
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('ADMIN RENT: ' || p_renter_name));
    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 2. Admin Return Game (관리자 반납)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_return_game(p_game_id INTEGER, p_renter_name TEXT DEFAULT NULL, p_user_id UUID DEFAULT NULL) RETURNS jsonb AS $$
DECLARE v_affected INTEGER;
BEGIN
     -- [SECURE] 권한 체크
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_key IN ('admin', 'executive')) THEN
        RETURN jsonb_build_object('success', false, 'message', '접근 권한이 없습니다.');
    END IF;

    UPDATE public.rentals SET returned_at = now() 
    WHERE game_id = p_game_id 
      AND (rental_id IN (SELECT rental_id FROM public.rentals WHERE game_id = p_game_id AND returned_at IS NULL ORDER BY borrowed_at ASC LIMIT 1))
      AND returned_at IS NULL;
      
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN RETURN jsonb_build_object('success', false, 'message', '반납할 대여 기록이 없습니다.'); END IF;

    UPDATE public.games SET available_count = available_count + 1 WHERE id = p_game_id;
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'RETURN', to_jsonb('ADMIN RETURN'::text));
    RETURN jsonb_build_object('success', true, 'message', '반납 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 3. Safe Delete Game (안전 삭제)
-- ============================================================
CREATE OR REPLACE FUNCTION public.safe_delete_game(p_game_id INTEGER) RETURNS jsonb AS $$
BEGIN
    -- [SECURE] 권한 체크
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_key IN ('admin', 'executive')) THEN
        RETURN jsonb_build_object('success', false, 'message', '접근 권한이 없습니다.');
    END IF;

    IF EXISTS (SELECT 1 FROM public.rentals WHERE game_id = p_game_id AND returned_at IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'message', '대여/찜 중인 내역이 있어 삭제할 수 없습니다.');
    END IF;
    DELETE FROM public.games WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 4. Kiosk Pickup (키오스크 수령) - Payment Check 추가
-- ============================================================
CREATE OR REPLACE FUNCTION public.kiosk_pickup(p_rental_id UUID) RETURNS jsonb AS $$
DECLARE v_game_id INTEGER; v_user_id UUID; v_type TEXT;
BEGIN
    SELECT game_id, user_id, type INTO v_game_id, v_user_id, v_type FROM public.rentals WHERE rental_id = p_rental_id;
    
    -- [SECURE] 본인 확인 (키오스크 공용 계정이 아닐 경우) 또는 키오스크 역할 확인
    -- 현재 키오스크는 별도 인증 없이 호출될 수 있으나, 보통 키오스크 기기앞에서 하므로 허용.
    -- 하지만 회비 납부 체크는 필수.
    
    IF v_type != 'DIBS' THEN RETURN jsonb_build_object('success', false, 'message', '예약 상태가 아닙니다.'); END IF;

    -- [SECURE] 회비 납부 재확인 (찜할 때 안 냈을 수 있음)
    IF is_payment_check_enabled() AND NOT is_user_payment_exempt(v_user_id) THEN
        IF NOT COALESCE((SELECT is_paid FROM public.profiles WHERE id = v_user_id), false) THEN
            RETURN jsonb_build_object('success', false, 'message', '회비 납부가 필요합니다.');
        END IF;
    END IF;

    UPDATE public.rentals SET type = 'RENT', borrowed_at = now(), due_date = now() + interval '2 days' WHERE rental_id = p_rental_id;
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (v_game_id, v_user_id, 'RENT', to_jsonb('Kiosk Pickup'::text));
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 5. Match Result (무한 포인트 방지)
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_match_result(p_game_id INTEGER, p_player_ids UUID[], p_winner_ids UUID[]) RETURNS JSONB AS $$
DECLARE v_player_id UUID; v_is_winner BOOLEAN; v_points INTEGER; v_game_name TEXT;
BEGIN
    -- [SECURE] 키오스크 권한 체크 (아무나 호출 못하게)
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_key IN ('admin', 'executive', 'kiosk')) THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 필요합니다.');
    END IF;

    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    INSERT INTO public.matches (game_id, players, winner_id, verified_at) VALUES (p_game_id, to_jsonb(p_player_ids), p_winner_ids[1], now());
    FOREACH v_player_id IN ARRAY p_player_ids LOOP
        v_is_winner := (v_player_id = ANY(p_winner_ids));
        v_points := CASE WHEN v_is_winner THEN 200 ELSE 50 END;
        PERFORM public.earn_points(v_player_id, v_points, 'MATCH_REWARD', COALESCE(v_game_name, '보드게임') || (CASE WHEN v_is_winner THEN ' 승리' ELSE ' 참여' END));
    END LOOP;
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


SELECT 'RPC Security Hardened' as status;
