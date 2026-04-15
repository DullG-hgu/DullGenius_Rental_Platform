-- ============================================================
-- [FINAL RPC V2] 모든 기능을 하나로 통합한 최신 표준 버전
-- 특징: V2(게임 기반) 스키마 완벽 대응, 모든 기능 통합, 사이드 이펙트 제로
-- 최종 수정일: 2026.02.17
-- ============================================================

-- ============================================================
-- 0. 유틸리티 및 설정
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_payment_check_enabled() RETURNS boolean AS $$ BEGIN RETURN true; END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION public.is_user_payment_exempt(p_user_id UUID) RETURNS boolean AS $$ 
BEGIN RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role_key IN ('admin', 'executive', 'payment_exempt')); END; $$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS public.earn_points(UUID, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.earn_points(p_user_id UUID, p_amount INTEGER, p_type TEXT, p_reason TEXT) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.point_transactions (user_id, amount, type, reason) VALUES (p_user_id, p_amount, p_type, p_reason);
    UPDATE public.profiles SET current_points = COALESCE(current_points, 0) + p_amount WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 1. 핵심 사용자 기능 (찜/대여/반납)
-- ============================================================

-- 1-1. 찜하기 (30분 한정 예약)
DROP FUNCTION IF EXISTS public.dibs_game(INTEGER, UUID);
CREATE OR REPLACE FUNCTION public.dibs_game(p_game_id INTEGER, p_user_id UUID) RETURNS jsonb AS $$
DECLARE v_game_name TEXT; v_affected INTEGER;
BEGIN
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

-- 1-2. 찜 취소
DROP FUNCTION IF EXISTS public.cancel_dibs(INTEGER, UUID);
CREATE OR REPLACE FUNCTION public.cancel_dibs(p_game_id INTEGER, p_user_id UUID) RETURNS jsonb AS $$
DECLARE v_affected INTEGER;
BEGIN
    UPDATE public.rentals SET returned_at = now() WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'DIBS' AND returned_at IS NULL;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN RETURN jsonb_build_object('success', false, 'message', '찜 내역이 없습니다.'); END IF;
    
    UPDATE public.games SET available_count = available_count + 1 WHERE id = p_game_id;
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'CANCEL_DIBS', to_jsonb('User cancelled dibs'::text));
    RETURN jsonb_build_object('success', true, 'message', '찜 취소 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1-3. 직접 대여 (찜에서 전환 또는 신규 대여)
DROP FUNCTION IF EXISTS public.rent_game(INTEGER, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.rent_game(p_game_id INTEGER, p_user_id UUID, p_renter_name TEXT) RETURNS jsonb AS $$
DECLARE v_game_name TEXT; v_affected INTEGER;
BEGIN
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

-- 1-4. 사용자 직접 반납
DROP FUNCTION IF EXISTS public.return_game(INTEGER, UUID);
CREATE OR REPLACE FUNCTION public.return_game(p_game_id INTEGER, p_user_id UUID) RETURNS jsonb AS $$
DECLARE v_affected INTEGER;
BEGIN
    UPDATE public.rentals SET returned_at = now() WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'RENT' AND returned_at IS NULL;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN RETURN jsonb_build_object('success', false, 'message', '대여 내역이 없습니다.'); END IF;
    
    UPDATE public.games SET available_count = available_count + 1 WHERE id = p_game_id;
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'RETURN', to_jsonb('Return: User'::text));
    RETURN jsonb_build_object('success', true, 'message', '반납 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. 관리자 기능 및 자동화
-- ============================================================

/**
 * 2-1. 관리자 대여 처리 (V3)
 * 찜(DIBS) 기록을 대여(RENT)로 전환하거나, 찜 기록이 없는 경우 신규 대여를 생성합니다.
 * rental_id가 제공되면 해당 인스턴스를 정확하게 타겟팅하여 대여로 전환합니다.
 */
DROP FUNCTION IF EXISTS public.admin_rent_game(INTEGER, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_rent_game(INTEGER, TEXT, UUID, UUID);
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
    -- [SECURITY] 관리자 권한 체크
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '관리자 권한이 없습니다.');
    END IF;

    -- [준비] 게임 이름 조회 및 존재 여부 확인
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN 
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.'); 
    END IF;

    -- [Step 1] 대여로 전환할 찜 기록(DIBS) 확정
    -- rental_id가 있으면 최우선 사용, 없으면 검색 로직 수행
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

    -- [Step 2] 찜 기록이 있는 경우 대여(RENT)로 상태 업데이트
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

    -- [Step 3] 찜 기록이 없었거나 업데이트 실패 시 신규 대여 기록 생성
    -- 이 경우 games 테이블의 재고(available_count)를 직접 차감함
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
    
    -- [로그] 활동 기록 남기기
    INSERT INTO public.logs (game_id, user_id, action_type, details) 
    VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('ADMIN RENT: ' || p_renter_name));
    
    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * 2-2. 관리자 반납 처리 (V3)
 * 대여(RENT) 기록을 종료(returned_at 설정)하고 재고를 복구합니다.
 * rental_id가 제공되면 해당 인스턴스를 정확하게 타겟팅하여 반납 처리합니다.
 */
DROP FUNCTION IF EXISTS public.admin_return_game(INTEGER, TEXT, UUID, UUID);
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
    -- [SECURITY] 관리자 권한 체크
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '관리자 권한이 없습니다.');
    END IF;

    -- [Step 1] 반납할 대여 건(RENT) 확정
    -- rental_id가 있으면 최우선 사용, 없으면 검색 로직(가장 오래된 기록) 수행
    IF p_rental_id IS NOT NULL THEN
        v_target_rental_id := p_rental_id;
    ELSE
        -- ID가 없을 경우 기존 정보를 조합하여 검색
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

    -- [준비] 실제 게임 ID 추출 (재고 업데이트용)
    SELECT game_id INTO v_game_id FROM public.rentals WHERE rental_id = v_target_rental_id;

    -- [Step 2] 반납 처리 (Returned_at 설정)
    UPDATE public.rentals SET returned_at = now() WHERE rental_id = v_target_rental_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN 
        RETURN jsonb_build_object('success', false, 'message', '반납 처리 실패'); 
    END IF;

    -- [Step 3] 재고(available_count) 복구 및 로그 기록
    UPDATE public.games SET available_count = available_count + 1 WHERE id = v_game_id;
    
    INSERT INTO public.logs (game_id, user_id, action_type, details) 
    VALUES (v_game_id, p_user_id, 'RETURN', to_jsonb('ADMIN RETURN'::text));

    RETURN jsonb_build_object('success', true, 'message', '반납 완료');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2-3. 만료된 찜 자동 정리 (스케줄러에서 사용)
DROP FUNCTION IF EXISTS public.cleanup_expired_dibs();
CREATE OR REPLACE FUNCTION public.cleanup_expired_dibs() RETURNS jsonb AS $$
DECLARE v_count INTEGER;
BEGIN
    WITH expired AS (
        UPDATE public.rentals SET returned_at = now() WHERE type = 'DIBS' AND returned_at IS NULL AND due_date < now() RETURNING game_id
    )
    UPDATE public.games g SET available_count = available_count + sub.cnt FROM (SELECT game_id, COUNT(*) as cnt FROM expired GROUP BY game_id) sub WHERE g.id = sub.game_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'cancelled_count', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2-4. 안전 삭제 (대여 중인 재고 확인)
DROP FUNCTION IF EXISTS public.safe_delete_game(INTEGER);
CREATE OR REPLACE FUNCTION public.safe_delete_game(p_game_id INTEGER) RETURNS jsonb AS $$
BEGIN
    -- [SECURITY] 관리자 권한 체크
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '관리자 권한이 없습니다.');
    END IF;

    IF EXISTS (SELECT 1 FROM public.rentals WHERE game_id = p_game_id AND returned_at IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'message', '대여/찜 중인 내역이 있어 삭제할 수 없습니다.');
    END IF;
    DELETE FROM public.games WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. 고성능 로그 및 분석 통계
-- ============================================================

-- 3-1. 일별 통계 테이블
CREATE TABLE IF NOT EXISTS public.game_daily_stats (
    id bigint generated always as identity primary key,
    game_id integer not null references public.games(id) on delete cascade,
    date date not null default current_date,
    view_count integer default 1,
    unique(game_id, date)
);

-- 3-1-1. 기존 로그 소급 적용 (Backfill)
-- 기존 logs 테이블의 모든 유의미한 활동(상세보기, 대여, 찜 등)을 기반으로 일별 통계 초기화/업데이트
INSERT INTO public.game_daily_stats (game_id, date, view_count)
SELECT game_id, created_at::date, COUNT(*)
FROM public.logs
WHERE game_id IS NOT NULL 
  AND (action_type IN ('VIEW', 'ACTION', 'RENT', 'DIBS', 'OUT_OF_STOCK_VIEW', 'RESOURCE_CLICK', 'MISS'))
  AND created_at >= (current_date - interval '30 days')
GROUP BY 1, 2
ON CONFLICT (game_id, date) DO UPDATE SET view_count = EXCLUDED.view_count;

-- 3-2. 조회수 증가 (Atomic & Stats)
DROP FUNCTION IF EXISTS public.increment_view_count(INTEGER);
CREATE OR REPLACE FUNCTION public.increment_view_count(p_game_id INTEGER) RETURNS VOID AS $$
BEGIN
    -- 1. 전역 조회수 증가
    UPDATE public.games SET total_views = total_views + 1 WHERE id = p_game_id;
    -- 2. 일별 통계 증가 (트렌드용)
    INSERT INTO public.game_daily_stats (game_id, date, view_count) VALUES (p_game_id, current_date, 1) ON CONFLICT (game_id, date) DO UPDATE SET view_count = game_daily_stats.view_count + 1;
    -- 3. 로그 테이블 기록 (사후 분석용)
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, auth.uid(), 'VIEW', to_jsonb('Page view'::text));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3-3. 주간 트렌드 게임 조회
DROP FUNCTION IF EXISTS public.get_trending_games();
CREATE OR REPLACE FUNCTION public.get_trending_games() RETURNS TABLE (id integer, name text, image text, category text, weekly_views bigint) AS $$
BEGIN
    RETURN QUERY SELECT g.id, g.name, g.image, g.category, SUM(s.view_count)::bigint as weekly_views FROM public.game_daily_stats s JOIN public.games g ON s.game_id = g.id WHERE s.date >= (current_date - interval '7 days') GROUP BY g.id, g.name, g.image, g.category ORDER BY weekly_views DESC LIMIT 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3-4. 유저 활동 로그 기록 (JSONB 대응)
DROP FUNCTION IF EXISTS public.send_user_log(INTEGER, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.send_user_log(p_game_id INTEGER DEFAULT NULL, p_action_type TEXT DEFAULT 'ACTION', p_details JSONB DEFAULT NULL) RETURNS JSONB AS $$
BEGIN
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, auth.uid(), p_action_type, p_details);
    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. 회원 관리 및 탈퇴
-- ============================================================

-- 4-1. 회원 탈퇴 (본인 확인 및 데이터 정리)
DROP FUNCTION IF EXISTS public.withdraw_user(UUID);
CREATE OR REPLACE FUNCTION public.withdraw_user(p_user_id UUID) RETURNS jsonb AS $$
DECLARE v_penalty INTEGER;
BEGIN
    IF auth.uid() != p_user_id THEN RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.'); END IF;
    IF EXISTS (SELECT 1 FROM public.rentals WHERE user_id = p_user_id AND returned_at IS NULL) THEN RETURN jsonb_build_object('success', false, 'message', '반납하지 않은 게임이 있습니다.'); END IF;
    
    SELECT penalty INTO v_penalty FROM public.profiles WHERE id = p_user_id;
    IF v_penalty > 0 THEN RETURN jsonb_build_object('success', false, 'message', '미정산 패널티가 있습니다.'); END IF;

    DELETE FROM public.point_transactions WHERE user_id = p_user_id;
    DELETE FROM public.user_roles WHERE user_id = p_user_id;
    UPDATE public.reviews SET user_id = NULL, author_name = '탈퇴 회원' WHERE user_id = p_user_id;
    UPDATE public.rentals SET user_id = NULL, renter_name = '탈퇴 회원' WHERE user_id = p_user_id;
    DELETE FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4-2. 가입 학기 자가 수정 (1회성)
DROP FUNCTION IF EXISTS public.update_my_semester(text);
CREATE OR REPLACE FUNCTION public.update_my_semester(p_new_semester text) RETURNS json AS $$
DECLARE v_is_fixed boolean;
BEGIN
    SELECT is_semester_fixed INTO v_is_fixed FROM public.profiles WHERE id = auth.uid();
    IF v_is_fixed THEN RETURN json_build_object('success', false, 'message', '이미 확정되었습니다.'); END IF;
    UPDATE public.profiles SET joined_semester = p_new_semester, is_semester_fixed = true WHERE id = auth.uid();
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. 키오스크 연동 (V2 대응 및 포인트 지급)
-- ============================================================

-- 5-1. 키오스크 대여
DROP FUNCTION IF EXISTS public.kiosk_rental(INTEGER, UUID);
CREATE OR REPLACE FUNCTION public.kiosk_rental(p_game_id INTEGER, p_user_id UUID) RETURNS jsonb AS $$
DECLARE v_game_name TEXT; v_affected INTEGER;
BEGIN
    -- [SECURITY] 키오스크 또는 관리자만 호출 가능
    IF NOT public.is_kiosk_or_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 없습니다.');
    END IF;

    IF is_payment_check_enabled() AND NOT is_user_payment_exempt(p_user_id) THEN
        IF NOT COALESCE((SELECT is_paid FROM public.profiles WHERE id = p_user_id), false) THEN
            RETURN jsonb_build_object('success', false, 'message', '회비 납부가 필요합니다.');
        END IF;
    END IF;

    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    UPDATE public.games SET available_count = available_count - 1 WHERE id = p_game_id AND available_count > 0;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.'); END IF;

    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date) VALUES (p_game_id, p_user_id, v_game_name, 'RENT', now(), now() + interval '2 days');
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('Kiosk Rental'::text));
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5-2. 키오스크 반납 (포인트 리워드)
-- [FIX] p_rental_id 추가하여 다중 카피 상황 대응
DROP FUNCTION IF EXISTS public.kiosk_return(INTEGER, UUID);
DROP FUNCTION IF EXISTS public.kiosk_return(INTEGER, UUID, UUID);
CREATE OR REPLACE FUNCTION public.kiosk_return(p_game_id INTEGER, p_user_id UUID, p_rental_id UUID DEFAULT NULL) RETURNS jsonb AS $$
DECLARE v_rental_id UUID; v_game_name TEXT;
BEGIN
    -- [SECURITY] 키오스크 또는 관리자만 호출 가능
    IF NOT public.is_kiosk_or_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 없습니다.');
    END IF;

    IF p_rental_id IS NOT NULL THEN
        SELECT rental_id, game_name INTO v_rental_id, v_game_name FROM public.rentals WHERE rental_id = p_rental_id AND returned_at IS NULL;
    ELSE
        SELECT rental_id, game_name INTO v_rental_id, v_game_name FROM public.rentals WHERE game_id = p_game_id AND user_id = p_user_id AND returned_at IS NULL AND type = 'RENT' LIMIT 1;
    END IF;

    IF v_rental_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', '대여 기록이 없습니다.'); END IF;

    UPDATE public.rentals SET returned_at = now() WHERE rental_id = v_rental_id;
    UPDATE public.games SET available_count = available_count + 1 WHERE id = p_game_id;
    PERFORM public.earn_points(p_user_id, 100, 'RETURN_REWARD', '키오스크 반납: ' || v_game_name);
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, p_user_id, 'RETURN', to_jsonb('Kiosk Return'::text));
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5-3. 키오스크 예약 수령 (픽업)
DROP FUNCTION IF EXISTS public.kiosk_pickup(UUID);
CREATE OR REPLACE FUNCTION public.kiosk_pickup(p_rental_id UUID) RETURNS jsonb AS $$
DECLARE v_game_id INTEGER; v_user_id UUID; v_type TEXT;
BEGIN
    -- [SECURITY] 키오스크 또는 관리자만 호출 가능
    IF NOT public.is_kiosk_or_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 없습니다.');
    END IF;

    SELECT game_id, user_id, type INTO v_game_id, v_user_id, v_type FROM public.rentals WHERE rental_id = p_rental_id;
    IF v_type != 'DIBS' THEN RETURN jsonb_build_object('success', false, 'message', '예약 상태가 아닙니다.'); END IF;
    UPDATE public.rentals SET type = 'RENT', borrowed_at = now(), due_date = now() + interval '2 days' WHERE rental_id = p_rental_id;
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (v_game_id, v_user_id, 'RENT', to_jsonb('Kiosk Pickup'::text));
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. 기타 매치 관리
-- ============================================================
DROP FUNCTION IF EXISTS public.register_match_result(INTEGER, UUID[], UUID[]);
CREATE OR REPLACE FUNCTION public.register_match_result(p_game_id INTEGER, p_player_ids UUID[], p_winner_ids UUID[]) RETURNS JSONB AS $$
DECLARE v_player_id UUID; v_is_winner BOOLEAN; v_points INTEGER; v_game_name TEXT;
BEGIN
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

-- ============================================================
-- 7. 하위 호환성 (레거시 별칭)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rent_any_copy(p_game_id INTEGER, p_user_id UUID) RETURNS jsonb AS $$ BEGIN RETURN public.rent_game(p_game_id, p_user_id, '회원'); END; $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.dibs_any_copy(p_game_id INTEGER, p_user_id UUID) RETURNS jsonb AS $$ BEGIN RETURN public.dibs_game(p_game_id, p_user_id); END; $$ LANGUAGE plpgsql SECURITY DEFINER;
