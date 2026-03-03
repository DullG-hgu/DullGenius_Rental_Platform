-- ================================================================
-- FUNCTIONS — public schema 현재 배포 상태
-- 프로젝트: hptvqangstiaatdtusrg
-- 생성 시각: 2026. 3. 3. 오후 6:08:56
-- 생성 스크립트: scripts/pull_schema.js
-- (자동 생성 파일 — 직접 수정하지 마세요)
-- ================================================================

-- 총 29개 함수

-- ----------------------------------------------------------------
-- 함수: admin_rent_game
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_rent_game(p_game_id integer, p_renter_name text, p_user_id uuid DEFAULT NULL::uuid, p_rental_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

    -- [Fix 3] to_jsonb(문자열) → jsonb_build_object
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('action', 'ADMIN RENT', 'renter', p_renter_name));

    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$function$

-- ----------------------------------------------------------------
-- 함수: admin_return_game
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_return_game(p_game_id integer, p_renter_name text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_rental_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
          AND type = 'RENT'
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

    -- [Fix 4] AND type = 'RENT' 추가 — DIBS 레코드 실수 반납 차단
    UPDATE public.rentals SET returned_at = now()
    WHERE rental_id = v_target_rental_id AND type = 'RENT';
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '반납 처리 실패 (이미 반납됐거나 RENT 타입이 아님)');
    END IF;

    UPDATE public.games SET available_count = available_count + 1 WHERE id = v_game_id;

    -- [Fix 3] to_jsonb(문자열) → jsonb_build_object
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (v_game_id, p_user_id, 'RETURN', jsonb_build_object('action', 'ADMIN RETURN'));

    RETURN jsonb_build_object('success', true, 'message', '반납 완료');
END;
$function$

-- ----------------------------------------------------------------
-- 함수: cancel_dibs
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_dibs(p_game_id integer, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$

-- ----------------------------------------------------------------
-- 함수: cleanup_expired_dibs
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_dibs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_count INTEGER;
BEGIN
    WITH expired AS (
        UPDATE public.rentals SET returned_at = now() WHERE type = 'DIBS' AND returned_at IS NULL AND due_date < now() RETURNING game_id
    )
    UPDATE public.games g SET available_count = available_count + sub.cnt FROM (SELECT game_id, COUNT(*) as cnt FROM expired GROUP BY game_id) sub WHERE g.id = sub.game_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'cancelled_count', v_count);
END;
$function$

-- ----------------------------------------------------------------
-- 함수: dibs_any_copy
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dibs_any_copy(p_game_id integer, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ BEGIN RETURN public.dibs_game(p_game_id, p_user_id); END; $function$

-- ----------------------------------------------------------------
-- 함수: dibs_game
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dibs_game(p_game_id integer, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_game_name    TEXT;
    v_quantity     INTEGER;
    v_active_count INTEGER;
BEGIN
    IF auth.uid() IS NULL OR (auth.uid() != p_user_id AND NOT public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    -- 동시성 안전을 위해 게임 행 잠금
    SELECT name, quantity INTO v_game_name, v_quantity
    FROM public.games WHERE id = p_game_id FOR UPDATE;

    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND type = 'DIBS' AND returned_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 찜한 게임입니다.');
    END IF;

    -- 실제 활성 대여/찜 수 계산 (만료된 DIBS 제외)
    SELECT COUNT(*) INTO v_active_count
    FROM public.rentals
    WHERE game_id = p_game_id
      AND returned_at IS NULL
      AND (type = 'RENT' OR (type = 'DIBS' AND due_date > now()));

    IF v_quantity - v_active_count <= 0 THEN
        UPDATE public.games SET available_count = 0 WHERE id = p_game_id;
        RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
    END IF;

    -- available_count를 실제 기준으로 동기화하며 차감
    UPDATE public.games
    SET available_count = (v_quantity - v_active_count) - 1
    WHERE id = p_game_id;

    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date)
    VALUES (p_game_id, p_user_id, v_game_name, 'DIBS', now(), now() + interval '30 minutes');

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'DIBS', to_jsonb('User reserved game'::text));

    RETURN jsonb_build_object('success', true, 'message', '찜 완료');
END;
$function$

-- ----------------------------------------------------------------
-- 함수: earn_points
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.earn_points(p_user_id uuid, p_amount integer, p_type text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    INSERT INTO public.point_transactions (user_id, amount, type, reason) VALUES (p_user_id, p_amount, p_type, p_reason);
    UPDATE public.profiles SET current_points = COALESCE(current_points, 0) + p_amount WHERE id = p_user_id;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: fix_rental_data_consistency
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fix_rental_data_consistency()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$

-- ----------------------------------------------------------------
-- 함수: get_my_roles
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_roles()
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN ARRAY(
    SELECT role_key 
    FROM public.user_roles 
    WHERE user_id = auth.uid()
  );
END;
$function$

-- ----------------------------------------------------------------
-- 함수: get_trending_games
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trending_games()
 RETURNS TABLE(id integer, name text, image text, category text, weekly_views bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY 
    SELECT 
        g.id, 
        g.name, 
        g.image, 
        g.category, 
        SUM(s.view_count)::bigint as weekly_views 
    FROM public.game_daily_stats s 
    JOIN public.games g ON s.game_id = g.id 
    WHERE s.date >= (current_date - interval '7 days') 
    GROUP BY g.id, g.name, g.image, g.category 
    ORDER BY weekly_views DESC 
    LIMIT 20; -- [여기만 5에서 20으로 바뀌었습니다!]
END;
$function$

-- ----------------------------------------------------------------
-- 함수: handle_new_user
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_allowed_name text;
    v_allowed_role text;
    v_allowed_phone text;
    v_allowed_semester text;
    v_meta_student_id text;
    v_meta_name text;
    v_meta_phone text;
    
    -- [NEW] 자동 학기 계산 변수
    v_month integer;
    v_year text;
    v_auto_semester text;
BEGIN
    -- 메타데이터에서 값 추출
    v_meta_student_id := new.raw_user_meta_data->>'student_id';
    v_meta_name := new.raw_user_meta_data->>'name';
    v_meta_phone := new.raw_user_meta_data->>'phone';
    -- Allowed Users 조회 (화이트리스트)
    SELECT name, role, phone, joined_semester 
    INTO v_allowed_name, v_allowed_role, v_allowed_phone, v_allowed_semester
    FROM public.allowed_users
    WHERE student_id = v_meta_student_id;
    -- [NEW] 가입 학기 자동 계산 로직
    IF v_allowed_semester IS NOT NULL THEN
        v_auto_semester := v_allowed_semester; -- 화이트리스트에 있으면 그거 사용
    ELSE
        v_month := extract(month from now());
        v_year := to_char(now(), 'YYYY');
        IF v_month <= 6 THEN
            v_auto_semester := v_year || '-1';
        ELSE
            v_auto_semester := v_year || '-2';
        END IF;
    END IF;
    -- 프로필 생성
    INSERT INTO public.profiles (id, student_id, name, phone, joined_semester)
    VALUES (
        new.id, 
        COALESCE(v_meta_student_id, 'GUEST_' || substr(new.id::text, 1, 8)),
        COALESCE(v_allowed_name, v_meta_name, 'Unknown'),
        COALESCE(v_allowed_phone, v_meta_phone, ''),
        v_auto_semester -- 자동 계산된 학기
    );
    -- 역할 부여
    INSERT INTO public.user_roles (user_id, role_key)
    VALUES (
        new.id, 
        COALESCE(v_allowed_role, 'member')
    );
    RETURN new;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Profile creation failed: %', SQLERRM;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: increment_view_count
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_view_count(p_game_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- 1. 전역 조회수 증가
    UPDATE public.games SET total_views = total_views + 1 WHERE id = p_game_id;
    -- 2. 일별 통계 증가 (트렌드용)
    INSERT INTO public.game_daily_stats (game_id, date, view_count) VALUES (p_game_id, current_date, 1) ON CONFLICT (game_id, date) DO UPDATE SET view_count = game_daily_stats.view_count + 1;
    -- 3. 로그 테이블 기록 (사후 분석용)
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, auth.uid(), 'VIEW', to_jsonb('Page view'::text));
END;
$function$

-- ----------------------------------------------------------------
-- 함수: is_admin
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
      AND role_key IN ('admin', 'executive', 'kiosk')
  );
END;
$function$

-- ----------------------------------------------------------------
-- 함수: is_payment_check_enabled
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_payment_check_enabled()
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$ BEGIN RETURN true; END; $function$

-- ----------------------------------------------------------------
-- 함수: is_user_payment_exempt
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_user_payment_exempt(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$ 
BEGIN RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role_key IN ('admin', 'executive', 'payment_exempt')); END; $function$

-- ----------------------------------------------------------------
-- 함수: kiosk_pickup
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kiosk_pickup(p_rental_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_game_id INTEGER; v_user_id UUID; v_type TEXT;
BEGIN
    SELECT game_id, user_id, type INTO v_game_id, v_user_id, v_type FROM public.rentals WHERE rental_id = p_rental_id;
    IF v_type != 'DIBS' THEN RETURN jsonb_build_object('success', false, 'message', '예약 상태가 아닙니다.'); END IF;
    UPDATE public.rentals SET type = 'RENT', borrowed_at = now(), due_date = now() + interval '2 days' WHERE rental_id = p_rental_id;
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (v_game_id, v_user_id, 'RENT', to_jsonb('Kiosk Pickup'::text));
    RETURN jsonb_build_object('success', true);
END;
$function$

-- ----------------------------------------------------------------
-- 함수: kiosk_rental
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kiosk_rental(p_game_id integer, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_game_name    TEXT;
    v_quantity     INTEGER;
    v_active_count INTEGER;
BEGIN
    IF is_payment_check_enabled() AND NOT is_user_payment_exempt(p_user_id) THEN
        IF NOT COALESCE((SELECT is_paid FROM public.profiles WHERE id = p_user_id), false) THEN
            RETURN jsonb_build_object('success', false, 'message', '회비 납부가 필요합니다.');
        END IF;
    END IF;

    -- 동시성 안전을 위해 게임 행 잠금
    SELECT name, quantity INTO v_game_name, v_quantity
    FROM public.games WHERE id = p_game_id FOR UPDATE;

    -- 실제 활성 대여/찜 수 계산 (만료된 DIBS 제외)
    SELECT COUNT(*) INTO v_active_count
    FROM public.rentals
    WHERE game_id = p_game_id
      AND returned_at IS NULL
      AND (type = 'RENT' OR (type = 'DIBS' AND due_date > now()));

    IF v_quantity - v_active_count <= 0 THEN
        UPDATE public.games SET available_count = 0 WHERE id = p_game_id;
        RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
    END IF;

    -- available_count를 실제 기준으로 동기화하며 차감
    UPDATE public.games
    SET available_count = (v_quantity - v_active_count) - 1
    WHERE id = p_game_id;

    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date)
    VALUES (p_game_id, p_user_id, v_game_name, 'RENT', now(), now() + interval '2 days');

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', to_jsonb('Kiosk Rental'::text));

    RETURN jsonb_build_object('success', true);
END;
$function$

-- ----------------------------------------------------------------
-- 함수: kiosk_return
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kiosk_return(p_game_id integer, p_user_id uuid, p_rental_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_rental_id UUID; v_game_name TEXT;
BEGIN
    IF p_rental_id IS NOT NULL THEN
        SELECT rental_id, game_name INTO v_rental_id, v_game_name
        FROM public.rentals
        WHERE rental_id = p_rental_id AND returned_at IS NULL;
    ELSE
        SELECT rental_id, game_name INTO v_rental_id, v_game_name
        FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND returned_at IS NULL AND type = 'RENT'
        LIMIT 1;
    END IF;

    IF v_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 기록이 없습니다.');
    END IF;

    UPDATE public.rentals SET returned_at = now() WHERE rental_id = v_rental_id;
    UPDATE public.games SET available_count = available_count + 1 WHERE id = p_game_id;
    PERFORM public.earn_points(p_user_id, 100, 'RETURN_REWARD', '키오스크 반납: ' || v_game_name);
    INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (p_game_id, p_user_id, 'RETURN', to_jsonb('Kiosk Return'::text));
    RETURN jsonb_build_object('success', true);
END;
$function$

-- ----------------------------------------------------------------
-- 함수: register_match_result
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_match_result(p_game_id integer, p_player_ids uuid[], p_winner_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$

-- ----------------------------------------------------------------
-- 함수: rent_any_copy
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rent_any_copy(p_game_id integer, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN public.rent_game(p_game_id, p_user_id, NULL);
END;
$function$

-- ----------------------------------------------------------------
-- 함수: rent_game
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rent_game(p_game_id integer, p_user_id uuid, p_renter_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_game_name TEXT; v_affected INTEGER;
BEGIN
    -- [AUTH] 본인 확인
    IF auth.uid() IS NULL OR (auth.uid() != p_user_id AND NOT public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;

    -- [Fix 2] COALESCE(p_renter_name, '회원') → p_renter_name (null 허용)
    UPDATE public.rentals
    SET type = 'RENT', returned_at = NULL, borrowed_at = now(),
        due_date = now() + interval '7 days',
        renter_name = p_renter_name
    WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'DIBS' AND returned_at IS NULL;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN
        UPDATE public.games SET available_count = available_count - 1
        WHERE id = p_game_id AND available_count > 0;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        IF v_affected = 0 THEN
            RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
        END IF;
        -- [Fix 2] COALESCE(p_renter_name, '회원') → p_renter_name
        INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date)
        VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days');
    END IF;

    -- [Fix 3] to_jsonb(문자열) → jsonb_build_object
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('action', 'RENT'));

    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$function$

-- ----------------------------------------------------------------
-- 함수: reset_own_password
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_own_password(p_student_id text, p_name text, p_phone text, p_new_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
    v_user_id UUID;
    v_target_email TEXT;
BEGIN
    -- 1. 프로필 정보 대조 (학번, 이름, 전화번호 일치 여부 확인)
    SELECT id INTO v_user_id
    FROM public.profiles
    WHERE student_id = p_student_id 
      AND name = p_name 
      AND REPLACE(phone, '-', '') = REPLACE(p_phone, '-', '');
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '입력하신 정보와 일치하는 회원을 찾을 수 없습니다.');
    END IF;
    -- 2. 해당 유저의 이메일 확인
    SELECT email INTO v_target_email FROM auth.users WHERE id = v_user_id;
    -- 3. 비밀번호 업데이트 (bcrypt 해시 생성을 위해 crypt 함수 사용)
    UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
        updated_at = now()
    WHERE id = v_user_id;
    -- 4. 로그 기록
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (
        NULL, 
        v_user_id, 
        'SELF_RESET_PW', 
        jsonb_build_object(
            'description', '사용자가 정보를 대조하여 비밀번호를 직접 재설정함'
        )
    );
    RETURN jsonb_build_object('success', true, 'message', '비밀번호가 성공적으로 변경되었습니다.');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '오류 발생: ' || SQLERRM);
END;
$function$

-- ----------------------------------------------------------------
-- 함수: reset_semester_payments
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_semester_payments()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$

-- ----------------------------------------------------------------
-- 함수: reset_user_password
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_user_password(target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
    v_operator_role text;
    v_target_email text;
    v_operator_id UUID;
BEGIN
    v_operator_id := auth.uid();
    -- 1. 권한 체크: 실행자가 관리자(admin)인지 확인
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = v_operator_id AND role_key = 'admin'
    ) THEN
        -- 보안 감사 로그: 권한 없는 시도 기록
        INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (NULL, v_operator_id, 'SECURITY_ALERT', jsonb_build_object('error', 'Unauthorized password reset attempt'));
        
        RETURN jsonb_build_object('success', false, 'message', '접근 권한이 없습니다.');
    END IF;
    -- 2. 대상 유저 존재 확인
    SELECT email INTO v_target_email FROM auth.users WHERE id = target_user_id;
    IF v_target_email IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 사용자입니다.');
    END IF;
    -- 3. 비밀번호 강제 업데이트 (12345678의 bcrypt 해시)
    UPDATE auth.users
    SET encrypted_password = crypt('12345678', gen_salt('bf')),
        updated_at = now()
    WHERE id = target_user_id;
    -- 4. 로그 기록
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (
        NULL, 
        v_operator_id, 
        'ADMIN_RESET_PW', 
        jsonb_build_object(
            'target_user_id', target_user_id, 
            'target_email', v_target_email,
            'description', '비밀번호를 12345678로 초기화함'
        )
    );
    RETURN jsonb_build_object('success', true, 'message', '비밀번호가 12345678로 초기화되었습니다.');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '오류 발생: ' || SQLERRM);
END;
$function$

-- ----------------------------------------------------------------
-- 함수: return_game
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_game(p_game_id integer, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$

-- ----------------------------------------------------------------
-- 함수: safe_delete_game
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.safe_delete_game(p_game_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$

-- ----------------------------------------------------------------
-- 함수: send_user_log
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_user_log(p_game_id integer DEFAULT NULL::integer, p_action_type text DEFAULT 'ACTION'::text, p_details jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    INSERT INTO public.logs (game_id, user_id, action_type, details) VALUES (p_game_id, auth.uid(), p_action_type, p_details);
    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$

-- ----------------------------------------------------------------
-- 함수: update_my_semester
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_semester(new_semester text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_fixed boolean;
BEGIN
  -- 1. 현재 고정 여부 확인
  SELECT is_semester_fixed INTO v_is_fixed
  FROM public.profiles
  WHERE id = v_user_id;
  -- 2. 이미 고정된 경우 수정 불가
  IF v_is_fixed THEN
    RETURN json_build_object('success', false, 'message', '이미 가입 학기가 확정되어 수정할 수 없습니다.');
  END IF;
  -- 3. 업데이트 및 고정 (최초 1회만 가능하도록)
  UPDATE public.profiles
  SET joined_semester = new_semester,
      is_semester_fixed = true
  WHERE id = v_user_id;
  RETURN json_build_object('success', true, 'message', '가입 학기가 저장되었습니다.');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'message', SQLERRM);
END;
$function$

-- ----------------------------------------------------------------
-- 함수: withdraw_user
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
