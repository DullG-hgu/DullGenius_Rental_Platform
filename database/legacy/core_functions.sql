-- ========================================
-- 🔧 핵심 SQL 함수 통합 관리 파일
-- ========================================
-- 목적: 보드게임 대여 시스템의 모든 핵심 RPC 함수를 한 곳에서 관리
-- 사용법: Supabase SQL Editor에서 전체 실행하여 모든 함수 생성/업데이트
-- 최종 업데이트: 2026-02-08

-- ========================================
-- 📋 목차
-- ========================================
-- 1. 데이터 정합성 관리
--    - fix_rental_data_consistency() : 종합 정리 함수
--    - cleanup_expired_dibs() : 만료된 찜 정리
--
-- 2. 사용자 대여 함수
--    - dibs_any_copy() : 찜하기 (30분)
--    - rent_any_copy() : 대여하기 (찜→대여 전환 포함)
--
-- 3. 관리자 전용 함수
--    - admin_rent_copy() : 관리자 대여 처리 (수기/찜 수령)
--    - admin_return_copy() : 관리자 반납 처리
--    - safe_delete_game() : 안전 게임 삭제
--
-- 4. 키오스크 함수
--    - kiosk_rental() : 키오스크 간편 대여
--    - kiosk_return() : 키오스크 간편 반납
--    - register_match_result() : 게임 매치 결과 등록
--    - earn_points() : 포인트 지급 (내부 함수)
--
-- 5. 유틸리티 함수
--    - increment_view_count() : 조회수 증가
--    - get_trending_games() : 급상승 게임 조회

-- ========================================
-- 1. 데이터 정합성 관리
-- ========================================

-- 1-1. 종합 정리 함수 (매 10분마다 실행 권장)
CREATE OR REPLACE FUNCTION public.fix_rental_data_consistency()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_expired_dibs_count INTEGER := 0;
    v_orphan_reserved_count INTEGER := 0;
    v_orphan_rented_count INTEGER := 0;
    v_duplicate_active_count INTEGER := 0;
    v_status_mismatch_count INTEGER := 0;
BEGIN
    -- 만료된 찜 정리
    UPDATE public.rentals
    SET returned_at = now()
    WHERE type = 'DIBS'
      AND returned_at IS NULL
      AND due_date < now();
    GET DIAGNOSTICS v_expired_dibs_count = ROW_COUNT;

    -- 고아 RESERVED 상태 복구
    UPDATE public.game_copies
    SET status = 'AVAILABLE'
    WHERE status = 'RESERVED'
      AND copy_id NOT IN (
          SELECT copy_id FROM public.rentals
          WHERE type = 'DIBS' AND returned_at IS NULL
      );
    GET DIAGNOSTICS v_orphan_reserved_count = ROW_COUNT;

    -- 고아 RENTED 상태 복구
    UPDATE public.game_copies
    SET status = 'AVAILABLE'
    WHERE status = 'RENTED'
      AND copy_id NOT IN (
          SELECT copy_id FROM public.rentals
          WHERE type = 'RENT' AND returned_at IS NULL
      );
    GET DIAGNOSTICS v_orphan_rented_count = ROW_COUNT;

    -- 중복 활성 대여 정리
    WITH duplicate_rentals AS (
        SELECT rental_id,
               ROW_NUMBER() OVER (PARTITION BY copy_id, type ORDER BY borrowed_at DESC) as rn
        FROM public.rentals
        WHERE returned_at IS NULL
    )
    UPDATE public.rentals
    SET returned_at = now()
    WHERE rental_id IN (SELECT rental_id FROM duplicate_rentals WHERE rn > 1);
    GET DIAGNOSTICS v_duplicate_active_count = ROW_COUNT;

    -- 상태 불일치 수정 (DIBS)
    UPDATE public.game_copies gc
    SET status = 'RESERVED'
    WHERE EXISTS (
        SELECT 1 FROM public.rentals r
        WHERE r.copy_id = gc.copy_id
          AND r.type = 'DIBS'
          AND r.returned_at IS NULL
          AND r.due_date > now()
    ) AND gc.status != 'RESERVED';

    -- 상태 불일치 수정 (RENT)
    UPDATE public.game_copies gc
    SET status = 'RENTED'
    WHERE EXISTS (
        SELECT 1 FROM public.rentals r
        WHERE r.copy_id = gc.copy_id
          AND r.type = 'RENT'
          AND r.returned_at IS NULL
    ) AND gc.status != 'RENTED';
    GET DIAGNOSTICS v_status_mismatch_count = ROW_COUNT;

    -- 반납 완료된 카피 상태 확인
    UPDATE public.game_copies gc
    SET status = 'AVAILABLE'
    WHERE (status = 'RENTED' OR status = 'RESERVED')
      AND NOT EXISTS (
          SELECT 1 FROM public.rentals r
          WHERE r.copy_id = gc.copy_id AND r.returned_at IS NULL
      );

    RETURN jsonb_build_object(
        'success', true,
        'message', '데이터 정합성 정리 완료',
        'details', jsonb_build_object(
            'expired_dibs_closed', v_expired_dibs_count,
            'orphan_reserved_fixed', v_orphan_reserved_count,
            'orphan_rented_fixed', v_orphan_rented_count,
            'duplicate_rentals_closed', v_duplicate_active_count,
            'status_mismatches_fixed', v_status_mismatch_count
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '정리 중 오류 발생', 'error', SQLERRM);
END;
$$;

-- 1-2. 만료된 찜 정리 (레거시, fix_rental_data_consistency에 통합됨)
CREATE OR REPLACE FUNCTION public.cleanup_expired_dibs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.rentals
    SET returned_at = now()
    WHERE type = 'DIBS'
      AND returned_at IS NULL
      AND due_date < now();

    UPDATE public.game_copies
    SET status = 'AVAILABLE'
    WHERE status = 'RESERVED'
      AND copy_id NOT IN (
          SELECT copy_id FROM public.rentals WHERE returned_at IS NULL
      );
END;
$$;

-- ========================================
-- 2. 사용자 대여 함수
-- ========================================

-- 2-1. 찜하기 (30분 예약)
CREATE OR REPLACE FUNCTION public.dibs_any_copy(
    p_game_id integer,
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_copy_id integer;
    v_game_name text;
    v_rental_id uuid;
    v_existing_count integer;
BEGIN
    -- 본인 확인
    IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다. (본인만 찜 가능)');
    END IF;

    -- 중복 이용 방지
    SELECT count(*) INTO v_existing_count
    FROM public.rentals r
    JOIN public.game_copies gc ON r.copy_id = gc.copy_id
    WHERE r.user_id = p_user_id
      AND gc.game_id = p_game_id
      AND r.returned_at IS NULL;

    IF v_existing_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 이용 중인 게임입니다.');
    END IF;

    -- 게임 이름 조회
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;

    -- 가용 재고 찾기
    SELECT copy_id INTO v_copy_id
    FROM public.game_copies
    WHERE game_id = p_game_id AND status = 'AVAILABLE'
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_copy_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 가능한 재고가 없습니다.');
    END IF;

    -- 상태 변경
    UPDATE public.game_copies SET status = 'RESERVED' WHERE copy_id = v_copy_id;

    -- 찜 기록 생성
    INSERT INTO public.rentals (user_id, copy_id, game_name, borrowed_at, due_date, type)
    VALUES (p_user_id, v_copy_id, v_game_name, now(), now() + interval '30 minutes', 'DIBS')
    RETURNING rental_id INTO v_rental_id;

    -- 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'DIBS', jsonb_build_object('copy_id', v_copy_id));

    RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2-2. 대여하기 (찜→대여 전환 포함, 다음날 23:59까지)
CREATE OR REPLACE FUNCTION public.rent_any_copy(
    p_game_id integer,
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_copy_id integer;
    v_game_name text;
    v_rental_id uuid;
    v_due_date timestamptz;
BEGIN
    -- 본인 확인
    IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    v_due_date := (current_date + 1) + time '23:59:59';

    -- 본인 찜 확인
    SELECT copy_id INTO v_copy_id
    FROM public.rentals
    WHERE user_id = p_user_id 
      AND type = 'DIBS' 
      AND returned_at IS NULL
      AND copy_id IN (SELECT copy_id FROM public.game_copies WHERE game_id = p_game_id)
    LIMIT 1;

    IF v_copy_id IS NOT NULL THEN
        -- 찜 전환: 기존 찜 종료
        UPDATE public.rentals SET returned_at = now() WHERE copy_id = v_copy_id AND type = 'DIBS';
        UPDATE public.game_copies SET status = 'RENTED' WHERE copy_id = v_copy_id;
    ELSE
        -- 새로 대여: 가용 재고 찾기
        SELECT copy_id INTO v_copy_id
        FROM public.game_copies
        WHERE game_id = p_game_id AND status = 'AVAILABLE'
        LIMIT 1
        FOR UPDATE SKIP LOCKED;

        IF v_copy_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '대여 가능한 재고가 없습니다.');
        END IF;
        UPDATE public.game_copies SET status = 'RENTED' WHERE copy_id = v_copy_id;
    END IF;

    -- 대여 기록 생성
    INSERT INTO public.rentals (user_id, copy_id, game_name, borrowed_at, due_date, type)
    VALUES (p_user_id, v_copy_id, v_game_name, now(), v_due_date, 'RENT')
    RETURNING rental_id INTO v_rental_id;

    -- 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('copy_id', v_copy_id));

    RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 3. 관리자 전용 함수
-- ========================================

-- 3-1. 관리자 대여 처리 (수기 대여 + 찜 수령)
CREATE OR REPLACE FUNCTION public.admin_rent_copy(
    p_game_id integer,
    p_renter_name text,
    p_user_id uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_copy_id integer;
    v_game_name text;
BEGIN
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;

    -- 찜 확인 (회원 ID 또는 이름으로)
    v_copy_id := NULL;
    
    IF p_user_id IS NOT NULL THEN
        SELECT copy_id INTO v_copy_id
        FROM public.rentals
        WHERE user_id = p_user_id 
          AND type = 'DIBS' 
          AND returned_at IS NULL
          AND copy_id IN (SELECT copy_id FROM public.game_copies WHERE game_id = p_game_id)
        LIMIT 1;
    ELSE
        SELECT copy_id INTO v_copy_id
        FROM public.rentals
        WHERE renter_name = p_renter_name
          AND type = 'DIBS' 
          AND returned_at IS NULL
          AND copy_id IN (SELECT copy_id FROM public.game_copies WHERE game_id = p_game_id)
        LIMIT 1;
    END IF;

    -- 찜한게 있으면 기존 찜 종료
    IF v_copy_id IS NOT NULL THEN
        UPDATE public.rentals SET returned_at = now() 
        WHERE copy_id = v_copy_id AND type = 'DIBS' AND returned_at IS NULL;
    ELSE
        -- 찜 없으면 가용 재고 찾기
        SELECT copy_id INTO v_copy_id
        FROM public.game_copies
        WHERE game_id = p_game_id AND status = 'AVAILABLE'
        LIMIT 1
        FOR UPDATE SKIP LOCKED;
        
        IF v_copy_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '처리 가능한 재고가 없습니다.');
        END IF;
    END IF;

    -- 상태 변경
    UPDATE public.game_copies SET status = 'RENTED' WHERE copy_id = v_copy_id;

    -- 대여 기록 생성 (관리자 기본 7일)
    INSERT INTO public.rentals (user_id, copy_id, game_name, renter_name, borrowed_at, due_date, type)
    VALUES (p_user_id, v_copy_id, v_game_name, p_renter_name, now(), now() + interval '7 days', 'RENT');

    -- 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('message', 'ADMIN RENT', 'renter', p_renter_name));

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3-1-NEW. [개선] copy_id를 직접 받는 관리자 대여 함수
CREATE OR REPLACE FUNCTION public.admin_rent_specific_copy(
    p_copy_id INTEGER,        -- ← 핵심: copy_id 직접 전달!
    p_renter_name TEXT,
    p_user_id UUID DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_game_id INTEGER;
    v_game_name TEXT;
    v_current_status TEXT;
BEGIN
    -- 1. copy 정보 조회 및 검증
    SELECT gc.game_id, gc.status, g.name 
    INTO v_game_id, v_current_status, v_game_name
    FROM public.game_copies gc
    JOIN public.games g ON gc.game_id = g.id
    WHERE gc.copy_id = p_copy_id;
    
    IF v_game_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 copy입니다.');
    END IF;
    
    -- 2. 상태 검증 및 중복 처리 방지
    IF v_current_status = 'RENTED' THEN
        -- 이미 RENTED 상태: 중복 처리 확인
        -- 활성 RENT가 있는지 확인
        IF EXISTS (
            SELECT 1 FROM public.rentals 
            WHERE copy_id = p_copy_id 
              AND type = 'RENT' 
              AND returned_at IS NULL
        ) THEN
            -- 이미 대여 처리됨 (중복 클릭)
            RETURN jsonb_build_object(
                'success', true, 
                'copy_id', p_copy_id, 
                'game_name', v_game_name,
                'message', '이미 대여 처리되었습니다.'
            );
        END IF;
    ELSIF v_current_status NOT IN ('AVAILABLE', 'RESERVED') THEN
        -- MAINTENANCE 등 대여 불가능한 상태
        RETURN jsonb_build_object('success', false, 'message', '대여 불가능한 상태입니다. (현재: ' || v_current_status || ')');
    END IF;
    
    -- 3. DIBS 종료 (해당 copy에 대한 활성 DIBS가 있다면)
    UPDATE public.rentals 
    SET returned_at = now() 
    WHERE copy_id = p_copy_id 
      AND type = 'DIBS' 
      AND returned_at IS NULL;
    
    -- 4. 상태 변경 + 대여 기록 생성 (원자적 트랜잭션)
    UPDATE public.game_copies SET status = 'RENTED' WHERE copy_id = p_copy_id;
    
    INSERT INTO public.rentals (user_id, copy_id, game_name, renter_name, borrowed_at, due_date, type)
    VALUES (p_user_id, p_copy_id, v_game_name, p_renter_name, now(), now() + interval '7 days', 'RENT');
    
    -- 5. 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (v_game_id, p_user_id, 'RENT', jsonb_build_object('message', 'ADMIN RENT', 'renter', p_renter_name, 'copy_id', p_copy_id));
    
    RETURN jsonb_build_object('success', true, 'copy_id', p_copy_id, 'game_name', v_game_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3-2. 관리자 반납 처리
CREATE OR REPLACE FUNCTION public.admin_return_copy(
    p_game_id integer
) RETURNS jsonb AS $$
DECLARE
    v_copy_id integer;
BEGIN
    -- 해당 게임 중 대여/찜 중인 카피 찾기
    SELECT copy_id INTO v_copy_id
    FROM public.game_copies
    WHERE game_id = p_game_id AND status != 'AVAILABLE'
    LIMIT 1;
    
    IF v_copy_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '반납할 재고가 없습니다.');
    END IF;

    -- 상태 변경
    UPDATE public.game_copies SET status = 'AVAILABLE' WHERE copy_id = v_copy_id;

    -- 대여 종료
    UPDATE public.rentals
    SET returned_at = now()
    WHERE copy_id = v_copy_id AND returned_at IS NULL;

    -- 로그
    INSERT INTO public.logs (game_id, action_type, details)
    VALUES (p_game_id, 'RETURN', jsonb_build_object('message', 'ADMIN Return'));

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3-2-NEW. [개선] copy_id를 직접 받는 관리자 반납 함수
CREATE OR REPLACE FUNCTION public.admin_return_specific_copy(
    p_copy_id INTEGER
) RETURNS jsonb AS $$
DECLARE
    v_game_id INTEGER;
    v_current_status TEXT;
    v_rental_count INTEGER;
BEGIN
    -- 1. copy 정보 조회
    SELECT gc.game_id, gc.status
    INTO v_game_id, v_current_status
    FROM public.game_copies gc
    WHERE gc.copy_id = p_copy_id;
    
    IF v_game_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 copy입니다.');
    END IF;
    
    -- 2. 상태 검증
    IF v_current_status = 'AVAILABLE' THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 반납된 상태입니다.');
    END IF;
    
    -- 3. 활성 rental 확인
    SELECT COUNT(*) INTO v_rental_count
    FROM public.rentals
    WHERE copy_id = p_copy_id AND returned_at IS NULL;
    
    IF v_rental_count = 0 THEN
        -- 고아 상태: rental 없이 RENTED/RESERVED 상태
        UPDATE public.game_copies SET status = 'AVAILABLE' WHERE copy_id = p_copy_id;
        RETURN jsonb_build_object('success', true, 'message', '고아 상태 복구 완료', 'copy_id', p_copy_id);
    END IF;
    
    -- 4. 상태 변경 + 대여 종료 (원자적 트랜잭션)
    UPDATE public.game_copies SET status = 'AVAILABLE' WHERE copy_id = p_copy_id;
    
    UPDATE public.rentals
    SET returned_at = now()
    WHERE copy_id = p_copy_id AND returned_at IS NULL;
    
    -- 5. 로그
    INSERT INTO public.logs (game_id, action_type, details)
    VALUES (v_game_id, 'RETURN', jsonb_build_object('message', 'ADMIN Return', 'copy_id', p_copy_id));
    
    RETURN jsonb_build_object('success', true, 'copy_id', p_copy_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3-3. 안전 게임 삭제
CREATE OR REPLACE FUNCTION public.safe_delete_game(
    p_game_id integer
) RETURNS jsonb AS $$
DECLARE
    v_active_count integer;
BEGIN
    SELECT count(*) INTO v_active_count
    FROM public.game_copies
    WHERE game_id = p_game_id AND status IN ('RENTED', 'RESERVED');

    IF v_active_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '대여/찜 중인 재고가 있어 삭제할 수 없습니다.');
    END IF;

    DELETE FROM public.games WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 4. 키오스크 함수
-- ========================================

-- 4-1. 포인트 지급 (내부 함수)
CREATE OR REPLACE FUNCTION public.earn_points(
    p_user_id UUID,
    p_amount INTEGER,
    p_type TEXT,
    p_reason TEXT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.point_transactions (user_id, amount, type, reason)
    VALUES (p_user_id, p_amount, p_type, p_reason);

    UPDATE public.profiles
    SET current_points = current_points + p_amount
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4-2. 키오스크 간편 대여
CREATE OR REPLACE FUNCTION public.kiosk_rental(
    p_game_id INTEGER,
    p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_copy_id INTEGER;
BEGIN
    SELECT copy_id INTO v_copy_id
    FROM public.game_copies
    WHERE game_id = p_game_id AND status = 'AVAILABLE'
    LIMIT 1;

    IF v_copy_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '현재 대여 가능한 재고가 없습니다.');
    END IF;

    -- 회비 납부 확인 (회비 검사가 활성화된 경우에만)
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

    INSERT INTO public.rentals (copy_id, user_id, type, borrowed_at, due_date)
    VALUES (v_copy_id, p_user_id, 'RENT', now(), now() + INTERVAL '2 days');

    UPDATE public.game_copies SET status = 'RENTED' WHERE copy_id = v_copy_id;
    
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4-3. 키오스크 간편 반납 (포인트 지급)
CREATE OR REPLACE FUNCTION public.kiosk_return(
    p_copy_id INTEGER,
    p_user_id UUID,
    p_condition_ok BOOLEAN DEFAULT TRUE
) RETURNS JSONB AS $$
DECLARE
    v_rental_id UUID;
    v_game_id INTEGER;
BEGIN
    SELECT rental_id, game_id INTO v_rental_id, v_game_id
    FROM public.rentals
    JOIN public.game_copies ON rentals.copy_id = game_copies.copy_id
    WHERE rentals.copy_id = p_copy_id 
      AND rentals.returned_at IS NULL
      AND (rentals.user_id = p_user_id OR p_user_id IS NULL);

    IF v_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '반납할 대여 기록을 찾을 수 없습니다.');
    END IF;

    UPDATE public.rentals SET returned_at = now() WHERE rental_id = v_rental_id;
    UPDATE public.game_copies SET status = 'AVAILABLE' WHERE copy_id = p_copy_id;

    -- 포인트 지급 (+100P)
    IF p_user_id IS NOT NULL THEN
        DECLARE
            v_game_name TEXT;
        BEGIN
            SELECT name INTO v_game_name FROM public.games WHERE id = (SELECT game_id FROM public.game_copies WHERE copy_id = p_copy_id);
            PERFORM earn_points(p_user_id, 100, 'RETURN_ON_TIME', '키오스크 반납 (' || COALESCE(v_game_name, '게임:' || p_copy_id) || ')');
        END;
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4-4. 게임 매치 결과 등록 (5분 쿨타임) - [UPDATED] 다중 승자 지원
CREATE OR REPLACE FUNCTION public.register_match_result(
    p_game_id INTEGER,
    p_player_ids UUID[],
    p_winner_ids UUID[] -- [MOD] 단일 ID에서 배열로 변경
) RETURNS JSONB AS $$
DECLARE
    v_last_played TIMESTAMP;
    v_player_id UUID;
    v_is_winner BOOLEAN;
    v_points INTEGER;
    v_game_name TEXT;
BEGIN
    SELECT played_at INTO v_last_played
    FROM public.matches
    WHERE game_id = p_game_id
    ORDER BY played_at DESC
    LIMIT 1;

    IF v_last_played IS NOT NULL AND (EXTRACT(EPOCH FROM (now() - v_last_played)) < 300) THEN
         RETURN jsonb_build_object('success', false, 'message', '너무 자주 등록할 수 없습니다. (5분 쿨타임)');
    END IF;

    -- 게임 이름 조회
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;

    INSERT INTO public.matches (game_id, players, winner_id, verified_at)
    VALUES (p_game_id, to_jsonb(p_player_ids), p_winner_ids[1], now()); -- 레거시 호환을 위해 첫번째 승자 저장

    FOREACH v_player_id IN ARRAY p_player_ids
    LOOP
        v_is_winner := (v_player_id = ANY(p_winner_ids)); -- [MOD] 배열 포함 여부 확인
        v_points := CASE WHEN v_is_winner THEN 200 ELSE 50 END;
        PERFORM earn_points(v_player_id, v_points, 'MATCH_REWARD', 
            COALESCE(v_game_name, '대전') || ' ' || (CASE WHEN v_is_winner THEN '승리' ELSE '참여' END));
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 5. 유틸리티 함수
-- ========================================

-- 5-1. 조회수 증가
CREATE OR REPLACE FUNCTION public.increment_view_count(
    p_game_id INTEGER
) RETURNS VOID AS $$
BEGIN
    UPDATE public.games
    SET total_views = total_views + 1
    WHERE id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5-2. 급상승 게임 조회 (최근 7일 기준)
CREATE OR REPLACE FUNCTION public.get_trending_games()
RETURNS TABLE (
    id INTEGER,
    name TEXT,
    image TEXT,
    category TEXT,
    weekly_views BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        g.id,
        g.name,
        g.image,
        g.category,
        COUNT(l.log_id) as weekly_views
    FROM public.games g
    LEFT JOIN public.logs l ON g.id = l.game_id 
        AND l.action_type = 'VIEW'
        AND l.created_at > now() - INTERVAL '7 days'
    GROUP BY g.id, g.name, g.image, g.category
    ORDER BY weekly_views DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 🎯 자동 실행 설정 (pg_cron)
-- ========================================

-- pg_cron 확장 활성화 (한 번만 실행)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 매 10분마다 데이터 정합성 정리
-- SELECT cron.schedule(
--     'fix-rental-consistency',
--     '*/10 * * * *',
--     'SELECT fix_rental_data_consistency();'
-- );

-- ========================================
-- ✅ 설치 확인
-- ========================================
-- 아래 쿼리로 모든 함수가 정상 생성되었는지 확인:
-- SELECT routine_name, routine_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'fix_rental_data_consistency',
--     'cleanup_expired_dibs',
--     'dibs_any_copy',
--     'rent_any_copy',
--     'admin_rent_copy',
--     'admin_return_copy',
--     'safe_delete_game',
--     'kiosk_rental',
--     'kiosk_return',
--     'register_match_result',
--     'earn_points',
--     'increment_view_count',
--     'get_trending_games'
--   )
-- ORDER BY routine_name;
