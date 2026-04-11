-- ========================================
-- 새로운 RPC 함수들 (game_id 기반)
-- Copy 시스템 제거 후 단순화된 버전
-- ========================================

-- ========================================
-- 1. 찜하기 (DIBS)
-- ========================================
CREATE OR REPLACE FUNCTION public.dibs_game(
    p_game_id INTEGER,
    p_user_id UUID
) RETURNS jsonb AS $$
DECLARE
    v_available INTEGER;
    v_game_name TEXT;
BEGIN
    -- 1. 게임 정보 및 가용 수량 확인
    SELECT name, available_count INTO v_game_name, v_available
    FROM public.games WHERE id = p_game_id;
    
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;
    
    IF v_available <= 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
    END IF;
    
    -- 2. 중복 찜 확인
    IF EXISTS (
        SELECT 1 FROM public.rentals 
        WHERE game_id = p_game_id 
          AND user_id = p_user_id 
          AND type = 'DIBS' 
          AND returned_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 찜한 게임입니다.');
    END IF;
    
    -- 3. 회비 납부 확인 (회비 검사가 활성화된 경우에만)
    IF is_payment_check_enabled() THEN
        -- 사용자가 회비 면제 역할을 가지고 있지 않은 경우에만 검사
        IF NOT is_user_payment_exempt(p_user_id) THEN
            -- 회비 납부 여부 확인
            DECLARE
                v_is_paid BOOLEAN;
            BEGIN
                SELECT is_paid INTO v_is_paid
                FROM public.profiles
                WHERE id = p_user_id;
                
                IF NOT COALESCE(v_is_paid, false) THEN
                    RETURN jsonb_build_object(
                        'success', false, 
                        'message', '회비를 납부해야 대여할 수 있습니다. 관리자에게 문의하세요.'
                    );
                END IF;
            END;
        END IF;
    END IF;
    
    -- 4. 찜 생성 + 가용 수량 감소
    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date)
    VALUES (p_game_id, p_user_id, v_game_name, 'DIBS', now(), now() + interval '30 minutes');
    
    UPDATE public.games 
    SET available_count = available_count - 1 
    WHERE id = p_game_id;
    
    -- 5. 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'DIBS', jsonb_build_object('message', 'User reserved game'));
    
    RETURN jsonb_build_object('success', true, 'message', '찜 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ========================================
-- 2. 찜 취소
-- ========================================
CREATE OR REPLACE FUNCTION public.cancel_dibs(
    p_game_id INTEGER,
    p_user_id UUID
) RETURNS jsonb AS $$
BEGIN
    -- 1. 찜 종료
    UPDATE public.rentals 
    SET returned_at = now()
    WHERE game_id = p_game_id 
      AND user_id = p_user_id 
      AND type = 'DIBS' 
      AND returned_at IS NULL;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '찜 내역이 없습니다.');
    END IF;
    
    -- 2. 가용 수량 증가
    UPDATE public.games 
    SET available_count = available_count + 1 
    WHERE id = p_game_id;
    
    -- 3. 로그 추가
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'CANCEL_DIBS', jsonb_build_object('message', 'User cancelled dibs'));
    
    RETURN jsonb_build_object('success', true, 'message', '찜 취소 완료');
END;

$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ========================================
-- 3. 대여하기 (RENT) - 찜에서 전환
-- ========================================
CREATE OR REPLACE FUNCTION public.rent_game(
    p_game_id INTEGER,
    p_user_id UUID,
    p_renter_name TEXT
) RETURNS jsonb AS $$
DECLARE
    v_game_name TEXT;
BEGIN
    -- 1. 게임 이름 조회
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;
    
    -- 2. 기존 DIBS 종료 (있다면)
    UPDATE public.rentals 
    SET returned_at = now()
    WHERE game_id = p_game_id 
      AND user_id = p_user_id 
      AND type = 'DIBS' 
      AND returned_at IS NULL;
    
    -- 3. RENT 생성 (가용 수량은 DIBS에서 이미 감소했으므로 변경 없음)
    INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date)
    VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days');
    
    -- 4. 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('message', 'User rented game', 'renter', p_renter_name));
    
    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ========================================
-- 4. 반납하기 (RETURN)
-- ========================================
CREATE OR REPLACE FUNCTION public.return_game(
    p_game_id INTEGER,
    p_user_id UUID
) RETURNS jsonb AS $$
BEGIN
    -- 1. rental 종료
    UPDATE public.rentals 
    SET returned_at = now()
    WHERE game_id = p_game_id 
      AND user_id = p_user_id 
      AND type = 'RENT'
      AND returned_at IS NULL;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 내역이 없습니다.');
    END IF;
    
    -- 2. 가용 수량 증가
    UPDATE public.games 
    SET available_count = available_count + 1 
    WHERE id = p_game_id;
    
    -- 3. 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RETURN', jsonb_build_object('message', 'User returned game'));
    
    RETURN jsonb_build_object('success', true, 'message', '반납 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ========================================
-- 5. 관리자 대여 (ADMIN RENT)
-- ========================================
CREATE OR REPLACE FUNCTION public.admin_rent_game(
    p_game_id INTEGER,
    p_renter_name TEXT,
    p_user_id UUID DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_game_name TEXT;
    v_available INTEGER;
BEGIN
    -- 1. 게임 정보 확인
    SELECT name, available_count INTO v_game_name, v_available
    FROM public.games WHERE id = p_game_id;
    
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;
    
    -- 2. 기존 DIBS 종료 (있다면)
    UPDATE public.rentals 
    SET returned_at = now()
    WHERE game_id = p_game_id 
      AND (user_id = p_user_id OR renter_name = p_renter_name)
      AND type = 'DIBS' 
      AND returned_at IS NULL;
    
    -- DIBS가 없었다면 가용 수량 확인 및 감소
    IF NOT FOUND THEN
        IF v_available <= 0 THEN
            RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
        END IF;
        
        UPDATE public.games 
        SET available_count = available_count - 1 
        WHERE id = p_game_id;
    END IF;
    
    -- 3. RENT 생성
    INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date)
    VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days');
    
    -- 4. 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('message', 'ADMIN RENT', 'renter', p_renter_name));
    
    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ========================================
-- 6. 관리자 반납 (ADMIN RETURN)
-- ========================================
CREATE OR REPLACE FUNCTION public.admin_return_game(
    p_game_id INTEGER,
    p_renter_name TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_affected INTEGER;
BEGIN
    -- 1. rental 종료 (renter_name 또는 user_id로 찾기)
    UPDATE public.rentals 
    SET returned_at = now()
    WHERE game_id = p_game_id 
      AND (
          (p_user_id IS NOT NULL AND user_id = p_user_id) OR
          (p_renter_name IS NOT NULL AND renter_name = p_renter_name) OR
          (p_user_id IS NULL AND p_renter_name IS NULL)
      )
      AND returned_at IS NULL;
    
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    
    IF v_affected = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '대여/찜 내역이 없습니다.');
    END IF;
    
    -- 2. 가용 수량 증가 (종료된 rental 개수만큼)
    UPDATE public.games 
    SET available_count = available_count + v_affected
    WHERE id = p_game_id;
    
    -- 3. 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RETURN', jsonb_build_object('message', 'ADMIN RETURN', 'renter', COALESCE(p_renter_name, 'Unknown')));
    
    RETURN jsonb_build_object('success', true, 'message', v_affected || '건 반납 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ========================================
-- 7. 만료된 찜 자동 취소 (스케줄러용)
-- ========================================
CREATE OR REPLACE FUNCTION public.cleanup_expired_dibs()
RETURNS jsonb AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- 1. 만료된 DIBS 찾아서 종료
    WITH expired AS (
        UPDATE public.rentals 
        SET returned_at = now()
        WHERE type = 'DIBS' 
          AND returned_at IS NULL 
          AND due_date < now()
        RETURNING game_id
    )
    -- 2. 가용 수량 복구
    UPDATE public.games g
    SET available_count = available_count + sub.cnt
    FROM (
        SELECT game_id, COUNT(*) as cnt
        FROM expired
        GROUP BY game_id
    ) sub
    WHERE g.id = sub.game_id;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN jsonb_build_object('success', true, 'cancelled', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ========================================
-- 8. available_count 동기화 (복구용)
-- ========================================
CREATE OR REPLACE FUNCTION public.sync_available_count()
RETURNS jsonb AS $$
BEGIN
    UPDATE public.games g
    SET available_count = g.quantity - COALESCE((
        SELECT COUNT(*) 
        FROM public.rentals r 
        WHERE r.game_id = g.id 
          AND r.returned_at IS NULL
    ), 0);
    
    RETURN jsonb_build_object('success', true, 'message', '동기화 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
