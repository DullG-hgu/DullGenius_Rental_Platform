-- ============================================================
-- [SECURITY] IDOR 취약점 수정 — auth.uid() 검증 추가
-- 작성일: 2026-03-01
-- 대상: 사용자 직접 호출 함수 4개 + 어드민 함수 2개
-- 제외: kiosk_* 함수 (anon key로 호출 → auth.uid() = NULL, 추가 시 키오스크 파괴)
-- ============================================================

-- ============================================================
-- 1. 찜하기 — auth.uid() 검증 추가
-- ============================================================
CREATE OR REPLACE FUNCTION public.dibs_game(p_game_id INTEGER, p_user_id UUID) RETURNS jsonb AS $$
DECLARE v_game_name TEXT; v_affected INTEGER;
BEGIN
    -- [AUTH] 본인 확인
    IF auth.uid() IS NULL OR (auth.uid() != p_user_id AND NOT public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.'); END IF;
    IF EXISTS (SELECT 1 FROM public.rentals WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'DIBS' AND returned_at IS NULL) THEN RETURN jsonb_build_object('success', false, 'message', '이미 찜한 게임입니다.'); END IF;

    UPDATE public.games SET available_count = available_count - 1 WHERE id = p_game_id AND available_count > 0;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.'); END IF;

    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date) VALUES (p_game_id, p_user_id, v_game_name, 'DIBS', now(), now() + interval '30 minutes');
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'DIBS', to_jsonb('User reserved game'::text));
    RETURN jsonb_build_object('success', true, 'message', '찜 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. 찜 취소 — auth.uid() 검증 추가
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_dibs(p_game_id INTEGER, p_user_id UUID) RETURNS jsonb AS $$
DECLARE v_affected INTEGER;
BEGIN
    -- [AUTH] 본인 확인
    IF auth.uid() IS NULL OR (auth.uid() != p_user_id AND NOT public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    UPDATE public.rentals SET returned_at = now() WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'DIBS' AND returned_at IS NULL;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN RETURN jsonb_build_object('success', false, 'message', '찜 내역이 없습니다.'); END IF;

    UPDATE public.games SET available_count = available_count + 1 WHERE id = p_game_id;
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'CANCEL_DIBS', to_jsonb('User cancelled dibs'::text));
    RETURN jsonb_build_object('success', true, 'message', '찜 취소 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. 직접 대여 — auth.uid() 검증 추가
-- ============================================================
CREATE OR REPLACE FUNCTION public.rent_game(p_game_id INTEGER, p_user_id UUID, p_renter_name TEXT) RETURNS jsonb AS $$
DECLARE v_game_name TEXT; v_affected INTEGER;
BEGIN
    -- [AUTH] 본인 확인
    IF auth.uid() IS NULL OR (auth.uid() != p_user_id AND NOT public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.'); END IF;

    UPDATE public.rentals SET type = 'RENT', returned_at = NULL, borrowed_at = now(), due_date = now() + interval '7 days', renter_name = COALESCE(p_renter_name, '회원')
    WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'DIBS' AND returned_at IS NULL;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN
        UPDATE public.games SET available_count = available_count - 1 WHERE id = p_game_id AND available_count > 0;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        IF v_affected = 0 THEN RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.'); END IF;
        INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date) VALUES (p_game_id, p_user_id, v_game_name, COALESCE(p_renter_name, '회원'), 'RENT', now(), now() + interval '7 days');
    END IF;

    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('Rental: ' || COALESCE(p_renter_name, 'User')));
    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. 사용자 반납 — auth.uid() 검증 추가
-- ============================================================
CREATE OR REPLACE FUNCTION public.return_game(p_game_id INTEGER, p_user_id UUID) RETURNS jsonb AS $$
DECLARE v_affected INTEGER;
BEGIN
    -- [AUTH] 본인 확인
    IF auth.uid() IS NULL OR (auth.uid() != p_user_id AND NOT public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    UPDATE public.rentals SET returned_at = now() WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'RENT' AND returned_at IS NULL;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN RETURN jsonb_build_object('success', false, 'message', '대여 내역이 없습니다.'); END IF;

    UPDATE public.games SET available_count = available_count + 1 WHERE id = p_game_id;
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'RETURN', to_jsonb('Return: User'::text));
    RETURN jsonb_build_object('success', true, 'message', '반납 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. 관리자 대여 — is_admin() 검증 추가
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_rent_game(
    p_game_id INTEGER,
    p_renter_name TEXT,
    p_user_id UUID DEFAULT NULL,
    p_rental_id UUID DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_game_name TEXT;
    v_affected INTEGER;
    v_target_rental_id UUID;
BEGIN
    -- [AUTH] 관리자 확인
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '관리자 권한이 필요합니다.');
    END IF;

    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;

    IF p_rental_id IS NOT NULL THEN
        v_target_rental_id := p_rental_id;
    ELSE
        SELECT rental_id INTO v_target_rental_id
        FROM public.rentals
        WHERE game_id = p_game_id
          AND (user_id = p_user_id OR renter_name = p_renter_name)
          AND type = 'DIBS'
          AND returned_at IS NULL
        LIMIT 1;
    END IF;

    IF v_target_rental_id IS NOT NULL THEN
        UPDATE public.rentals
        SET type = 'RENT',
            returned_at = NULL,
            borrowed_at = now(),
            due_date = now() + interval '7 days',
            renter_name = p_renter_name,
            user_id = COALESCE(p_user_id, user_id)
        WHERE rental_id = v_target_rental_id
          AND type = 'DIBS';
        GET DIAGNOSTICS v_affected = ROW_COUNT;
    ELSE
        v_affected := 0;
    END IF;

    IF v_affected = 0 THEN
        UPDATE public.games SET available_count = available_count - 1
        WHERE id = p_game_id AND available_count > 0;
        GET DIAGNOSTICS v_affected = ROW_COUNT;

        IF v_affected = 0 THEN
            RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
        END IF;

        INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date)
        VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days');
    END IF;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('ADMIN RENT: ' || p_renter_name));

    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. 관리자 반납 — is_admin() 검증 추가
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_return_game(
    p_game_id INTEGER,
    p_renter_name TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_rental_id UUID DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_affected INTEGER;
    v_target_rental_id UUID;
    v_game_id INTEGER;
BEGIN
    -- [AUTH] 관리자 확인
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '관리자 권한이 필요합니다.');
    END IF;

    IF p_rental_id IS NOT NULL THEN
        v_target_rental_id := p_rental_id;
    ELSE
        SELECT rental_id INTO v_target_rental_id
        FROM public.rentals
        WHERE game_id = p_game_id
          AND returned_at IS NULL
          AND (
              (p_user_id IS NOT NULL AND user_id = p_user_id) OR
              (p_user_id IS NULL AND p_renter_name IS NOT NULL AND renter_name = p_renter_name) OR
              (p_user_id IS NULL AND p_renter_name IS NULL)
          )
        ORDER BY borrowed_at ASC
        LIMIT 1;
    END IF;

    IF v_target_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '반납할 대여 기록을 찾을 수 없습니다.');
    END IF;

    SELECT game_id INTO v_game_id FROM public.rentals WHERE rental_id = v_target_rental_id;

    UPDATE public.rentals SET returned_at = now() WHERE rental_id = v_target_rental_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '반납 처리 실패');
    END IF;

    UPDATE public.games SET available_count = available_count + 1 WHERE id = v_game_id;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (v_game_id, p_user_id, 'RETURN', to_jsonb('ADMIN RETURN'::text));

    RETURN jsonb_build_object('success', true, 'message', '반납 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 확인
-- ============================================================
SELECT 'IDOR auth check applied to: dibs_game, cancel_dibs, rent_game, return_game, admin_rent_game, admin_return_game' AS status;
