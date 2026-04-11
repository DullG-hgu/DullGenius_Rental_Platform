-- ========================================
-- Kiosk Return Logic Update (V2)
-- Purpose: Remove dependency on game_copies and use game_id directly
-- ========================================

CREATE OR REPLACE FUNCTION public.kiosk_return(
    p_game_id INTEGER,
    p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_rental_id UUID;
    v_game_name TEXT;
BEGIN
    -- 1. 반납할 대여 기록 찾기 (가장 오래된 것부터)
    SELECT rental_id, game_name INTO v_rental_id, v_game_name
    FROM public.rentals
    WHERE game_id = p_game_id
      AND user_id = p_user_id
      AND returned_at IS NULL
    ORDER BY borrowed_at ASC
    LIMIT 1;

    IF v_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '반납할 대여 기록을 찾을 수 없습니다.');
    END IF;

    -- 2. 대여 기록 업데이트
    UPDATE public.rentals 
    SET returned_at = now() 
    WHERE rental_id = v_rental_id;

    -- 3. 게임 재고 업데이트 (available_count 증가)
    UPDATE public.games
    SET available_count = available_count + 1
    WHERE id = p_game_id;

    -- 4. 포인트 지급 (+100P)
    IF p_user_id IS NOT NULL THEN
        PERFORM earn_points(p_user_id, 100, 'RETURN_ON_TIME', '키오스크 반납 (게임: ' || COALESCE(v_game_name, 'Unknown') || ')');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
