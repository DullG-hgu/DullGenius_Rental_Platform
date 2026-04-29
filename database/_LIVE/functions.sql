-- ================================================================
-- FUNCTIONS — public schema 현재 배포 상태
-- 프로젝트: hptvqangstiaatdtusrg
-- 생성 시각: 2026. 4. 29. PM 6:26:25
-- 생성 스크립트: scripts/pull_schema.js
-- (자동 생성 파일 — 직접 수정하지 마세요)
-- ================================================================

-- 총 67개 함수

-- ----------------------------------------------------------------
-- 함수: _event_calc_fee
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_calc_fee(p_pricing jsonb, p_tier text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fee int;
  v_lookup_tier text;
BEGIN
  IF p_pricing IS NULL OR p_pricing = '{}'::jsonb THEN RETURN 0; END IF;
  -- member tier는 non_member 가격을 공유 (UI 단순화: 정회원/비회원/현장결제 3단)
  v_lookup_tier := CASE WHEN p_tier = 'member' THEN 'non_member' ELSE p_tier END;
  v_fee := COALESCE((p_pricing -> 'base' ->> v_lookup_tier)::int, 0);
  RETURN v_fee;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: _event_generate_invite_code
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_generate_invite_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempts int := 0;
  v_exists bool;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..4 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;
    v_code := v_code || '-';
    FOR i IN 1..4 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;
    SELECT EXISTS(SELECT 1 FROM public.event_teams WHERE invite_code = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
    v_attempts := v_attempts + 1;
    IF v_attempts > 20 THEN RAISE EXCEPTION 'invite_code_generation_failed'; END IF;
  END LOOP;
  RETURN v_code;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: _event_is_full
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_is_full(p_event_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_capacity int;
  v_unit text;
  v_count int;
BEGIN
  SELECT capacity, capacity_unit INTO v_capacity, v_unit
    FROM public.events WHERE id = p_event_id;
  IF v_capacity IS NULL THEN RETURN false; END IF;

  IF v_unit = 'team' THEN
    SELECT count(*) INTO v_count FROM public.event_teams
      WHERE event_id = p_event_id AND status != 'cancelled';
  ELSE
    SELECT count(*) INTO v_count FROM public.event_registrations
      WHERE event_id = p_event_id
        AND status IN ('pending','paid');
  END IF;
  RETURN v_count >= v_capacity;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: _event_make_depositor_name
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_make_depositor_name(p_event_slug text, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN p_event_slug || '_' || regexp_replace(p_name, '\s+', '', 'g');
END;
$function$

-- ----------------------------------------------------------------
-- 함수: _fuzzy_match_games
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fuzzy_match_games(raw text)
 RETURNS integer[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tokens text[];
    v_token  text;
    v_trim   text;
    v_id     int;
    v_result int[] := '{}';
BEGIN
    IF raw IS NULL OR btrim(raw) = '' THEN
        RETURN '{}';
    END IF;

    v_tokens := string_to_array(raw, ',');

    FOREACH v_token IN ARRAY v_tokens LOOP
        v_trim := btrim(v_token);
        IF v_trim = '' THEN CONTINUE; END IF;

        -- exact match 먼저
        SELECT id INTO v_id
        FROM public.games
        WHERE name = v_trim
        ORDER BY id
        LIMIT 1;

        IF v_id IS NULL THEN
            -- ILIKE fallback (case-insensitive 부분 일치)
            SELECT id INTO v_id
            FROM public.games
            WHERE name ILIKE '%' || v_trim || '%'
            ORDER BY length(name), id
            LIMIT 1;
        END IF;

        IF v_id IS NOT NULL THEN
            v_result := array_append(v_result, v_id);
            v_id := NULL;
        END IF;
    END LOOP;

    RETURN v_result;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: _parse_duration
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._parse_duration(raw text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE v_match text[];
BEGIN
    IF raw IS NULL OR btrim(raw) = '' THEN RETURN NULL; END IF;
    v_match := regexp_match(raw, '(\d+)\s*일');
    IF v_match IS NULL THEN RETURN NULL; END IF;
    RETURN v_match[1]::int;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: _parse_fee
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._parse_fee(raw text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE v_match text[];
BEGIN
    IF raw IS NULL OR btrim(raw) = '' THEN RETURN NULL; END IF;
    v_match := regexp_match(raw, '(\d+)\s*원');
    IF v_match IS NULL THEN RETURN NULL; END IF;
    RETURN v_match[1]::int;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: _parse_game_count
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._parse_game_count(raw text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE v_match text[];
BEGIN
    IF raw IS NULL OR btrim(raw) = '' THEN RETURN NULL; END IF;
    v_match := regexp_match(raw, '(\d+)\s*개');
    IF v_match IS NULL THEN RETURN NULL; END IF;
    RETURN v_match[1]::int;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: _parse_pickup
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._parse_pickup(raw text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    v_date_match text;
    v_time_match text;
    v_ampm       text;
    v_year       int;
    v_month      int;
    v_day        int;
    v_hour       int := 12;
    v_minute     int := 0;
    v_parts      text[];
    v_result     timestamptz;
BEGIN
    IF raw IS NULL OR btrim(raw) = '' THEN RETURN NULL; END IF;

    -- 날짜 추출: YYYY[-./년 ]M[-./월 ]D
    v_date_match := (regexp_match(
        raw,
        '(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})'
    ))[1];
    IF v_date_match IS NULL THEN
        -- 매칭 실패
        RETURN NULL;
    END IF;

    v_parts := regexp_match(raw, '(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})');
    v_year  := v_parts[1]::int;
    v_month := v_parts[2]::int;
    v_day   := v_parts[3]::int;

    -- 오전/오후 감지
    v_ampm := (regexp_match(raw, '(오전|오후|AM|PM|am|pm)'))[1];

    -- 시간 추출: "14:30" / "14시 30분" / "14시" / "2시"
    v_parts := regexp_match(raw, '(\d{1,2})[:시]\s*(\d{1,2})?');
    IF v_parts IS NOT NULL THEN
        v_hour := v_parts[1]::int;
        IF v_parts[2] IS NOT NULL THEN
            v_minute := v_parts[2]::int;
        END IF;
        IF v_ampm IN ('오후', 'PM', 'pm') AND v_hour < 12 THEN
            v_hour := v_hour + 12;
        ELSIF v_ampm IN ('오전', 'AM', 'am') AND v_hour = 12 THEN
            v_hour := 0;
        END IF;
    END IF;

    BEGIN
        v_result := make_timestamptz(v_year, v_month, v_day, v_hour, v_minute, 0, 'Asia/Seoul');
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
    RETURN v_result;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: _tg_event_set_updated_at
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tg_event_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: admin_extend_rentals
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_extend_rentals(p_user_id uuid DEFAULT NULL::uuid, p_renter_name text DEFAULT NULL::text, p_game_id integer DEFAULT NULL::integer, p_rental_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_new_due_date TIMESTAMP WITH TIME ZONE;
    r RECORD;
    v_count INTEGER := 0;
BEGIN
    -- [안전장치 1] 타 렌탈 건 침해 방지: 조건이 모두 NULL이면 전체 업데이트 위험이 있으므로 즉시 차단
    IF p_user_id IS NULL AND p_renter_name IS NULL AND p_game_id IS NULL AND p_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '연장 대상을 특정할 수 없습니다. (모든 식별자가 비어있음)');
    END IF;
    -- 현재 시간의 날짜(자정 00:00:00) 기준으로 N일을 더한 뒤, 23시간 59분 59초를 더해 해당일 밤 12시 세팅
    v_new_due_date := date_trunc('day', now()) + (p_days || ' days')::interval + interval '23 hours 59 minutes 59 seconds';
    FOR r IN 
        SELECT rental_id, game_id, user_id, renter_name 
        FROM public.rentals
        WHERE type = 'RENT' 
          AND returned_at IS NULL
          AND (p_rental_id IS NULL OR rental_id = p_rental_id)
          AND (p_game_id IS NULL OR game_id = p_game_id)
          -- [안전장치 2] user_id와 renter_name 조건 최적화
          -- user_id가 있으면 user_id만 확실하게 매칭하고, 없으면 renter_name 매칭으로 우회하여 동명이나 권한 겹침 오류 최소화
          AND (
              (p_user_id IS NOT NULL AND user_id = p_user_id) OR
              (p_user_id IS NULL AND p_renter_name IS NOT NULL AND renter_name = p_renter_name) OR
              (p_user_id IS NULL AND p_renter_name IS NULL)
          )
    LOOP
        -- 기한 수정
        UPDATE public.rentals SET due_date = v_new_due_date WHERE rental_id = r.rental_id;
        
        -- 연장 로그 기록 추가
        INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (r.game_id, r.user_id, 'EXTEND', jsonb_build_object('message', COALESCE(p_days, 7) || '일 기한 연장', 'days', p_days, 'new_due_date', v_new_due_date, 'renter', COALESCE(r.renter_name, 'Unknown')));
        
        v_count := v_count + 1;
    END LOOP;
    
    IF v_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '조건에 맞는 연장할 활성 대여 건이 ��습니다. 이미 반납되었거나 대상을 찾을 수 없습니다.');
    END IF;
    
    RETURN jsonb_build_object('success', true, 'message', v_count || '건 연장 처리 완료', 'new_due_date', v_new_due_date);
END;
$function$

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
            user_id = COALESCE(p_user_id, user_id),
            source = 'admin'
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

        INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date, source)
        VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days', 'admin');
    END IF;

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
DECLARE
    v_dibs_count    INTEGER;
    v_hold_count    INTEGER;
    v_affected_ids  INTEGER[];
BEGIN
    -- 1) 만료된 DIBS 반납 마킹 + 영향 게임 수집
    WITH expired AS (
        UPDATE public.rentals
        SET returned_at = now()
        WHERE type = 'DIBS'
          AND returned_at IS NULL
          AND due_date < now()
        RETURNING game_id
    ),
    grouped AS (
        SELECT game_id, COUNT(*) AS cnt
        FROM expired
        GROUP BY game_id
    )
    UPDATE public.games g
    SET available_count = COALESCE(g.available_count, 0) + grouped.cnt
    FROM grouped
    WHERE g.id = grouped.game_id;
    GET DIAGNOSTICS v_dibs_count = ROW_COUNT;

    -- 2) 만료된 HOLD 반납 마킹 + 영향 게임 수집
    WITH expired_holds AS (
        UPDATE public.rentals
        SET returned_at = now()
        WHERE type = 'HOLD'
          AND returned_at IS NULL
          AND due_date < now()
        RETURNING game_id
    )
    SELECT array_agg(game_id)
    INTO v_affected_ids
    FROM expired_holds;

    v_hold_count := COALESCE(array_length(v_affected_ids, 1), 0);

    -- 3) HOLD 만료로 영향 받은 게임의 available_count 재계산
    --    (7일 lookahead 윈도우 기준)
    IF v_hold_count > 0 THEN
        UPDATE public.games g
        SET available_count = GREATEST(
            0,
            g.quantity - COALESCE((
                SELECT COUNT(*)
                FROM public.rentals r
                WHERE r.game_id = g.id
                  AND r.returned_at IS NULL
                  AND (
                      r.type = 'RENT'
                      OR (r.type = 'DIBS' AND r.due_date > now())
                      OR (r.type = 'HOLD'
                          AND r.borrowed_at <= now() + interval '7 days'
                          AND r.due_date > now())
                  )
            ), 0)
        )
        WHERE g.id = ANY(v_affected_ids);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'cancelled_count', v_dibs_count,
        'expired_hold_count', v_hold_count
    );
END;
$function$

-- ----------------------------------------------------------------
-- 함수: confirm_rental_request
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_rental_request(p_request_id uuid, p_game_ids integer[], p_pickup_at timestamp with time zone, p_duration_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_req           public.rental_requests%ROWTYPE;
    v_gid           int;
    v_hold_id       uuid;
    v_hold_ids      uuid[] := '{}';
    v_borrowed_at   timestamptz;
    v_due_date      timestamptz;
    v_note          text;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    SELECT * INTO v_req FROM public.rental_requests WHERE id = p_request_id;
    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '요청을 찾을 수 없습니다.');
    END IF;
    IF v_req.status NOT IN ('pending', 'needs_review') THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 처리된 요청입니다.');
    END IF;
    IF p_pickup_at IS NULL OR p_duration_days IS NULL OR p_duration_days <= 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '수령일/기간이 올바르지 않습니다.');
    END IF;
    IF p_game_ids IS NULL OR array_length(p_game_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '게임을 한 개 이상 지정하세요.');
    END IF;

    v_borrowed_at := p_pickup_at - interval '24 hours';
    v_due_date    := p_pickup_at + (p_duration_days || ' days')::interval;
    v_note        := 'HOLD request:' || v_req.id::text;

    FOR v_gid IN SELECT unnest(p_game_ids) LOOP
        INSERT INTO public.rentals (
            game_id, user_id, game_name, renter_name, type,
            borrowed_at, due_date, source, note
        )
        SELECT v_gid, NULL, g.name, v_req.requester_name, 'HOLD',
               v_borrowed_at, v_due_date, 'form', v_note
        FROM public.games g WHERE g.id = v_gid
        RETURNING rental_id INTO v_hold_id;

        v_hold_ids := array_append(v_hold_ids, v_hold_id);

        IF v_borrowed_at <= now() + interval '7 days' AND v_due_date > now() THEN
            UPDATE public.games
            SET available_count = GREATEST(0, COALESCE(available_count, 0) - 1)
            WHERE id = v_gid;
        END IF;
    END LOOP;

    UPDATE public.rental_requests
    SET status = 'manual_confirmed',
        matched_game_ids = p_game_ids,
        pickup_at = p_pickup_at,
        duration_days = p_duration_days,
        hold_rental_ids = v_hold_ids,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (
        NULL, auth.uid(), 'RENTAL_REQUEST_CONFIRM',
        jsonb_build_object('request_id', p_request_id, 'hold_count', array_length(v_hold_ids, 1))
    );

    RETURN jsonb_build_object('success', true, 'hold_rental_ids', v_hold_ids);
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

    SELECT COUNT(*) INTO v_active_count
    FROM public.rentals
    WHERE game_id = p_game_id
      AND returned_at IS NULL
      AND (
          type = 'RENT'
          OR (type = 'DIBS' AND due_date > now())
          OR (type = 'HOLD'
              AND borrowed_at <= now() + interval '7 days'
              AND due_date > now())
      );

    IF v_quantity - v_active_count <= 0 THEN
        UPDATE public.games SET available_count = 0 WHERE id = p_game_id;
        RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
    END IF;

    UPDATE public.games
    SET available_count = (v_quantity - v_active_count) - 1
    WHERE id = p_game_id;

    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date, source)
    VALUES (p_game_id, p_user_id, v_game_name, 'DIBS', now(), now() + interval '30 minutes', 'app');

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
-- 함수: event_admin_register
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_admin_register(p_event_id uuid, p_user_id uuid, p_membership_tier text DEFAULT NULL::text, p_team_id uuid DEFAULT NULL::uuid, p_mark_paid boolean DEFAULT false, p_actual_depositor_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_tier text;
  v_fee int;
  v_reg_id uuid;
  v_depositor text;
  v_status text;
  v_received timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_registrations
             WHERE event_id = p_event_id AND user_id = p_user_id
               AND status NOT IN ('cancelled_unpaid','cancelled_self','cancelled_admin','refunded'))
  THEN
    RAISE EXCEPTION 'duplicate_registration';
  END IF;

  IF p_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_teams WHERE id = p_team_id AND event_id = p_event_id) THEN
      RAISE EXCEPTION 'team_not_in_event';
    END IF;
  END IF;

  v_tier := COALESCE(p_membership_tier, public.resolve_membership_tier(p_user_id));
  IF v_tier NOT IN ('paid_member','member','non_member','walk_in','invited') THEN
    RAISE EXCEPTION 'invalid_membership_tier';
  END IF;

  -- [PATCH] walk_in은 행사 설정에서 허용된 경우에만
  IF v_tier = 'walk_in' AND NOT v_event.allow_walk_in THEN
    RAISE EXCEPTION 'walk_in_not_allowed';
  END IF;

  v_fee := public._event_calc_fee(v_event.pricing, v_tier);
  v_depositor := public._event_make_depositor_name(v_event.slug, v_profile.name);

  IF p_mark_paid THEN
    v_status := 'paid';
    v_received := now();
  ELSE
    v_status := 'pending';
    v_received := NULL;
  END IF;

  INSERT INTO public.event_registrations (
    event_id, team_id, user_id,
    applicant_name, applicant_student_id, applicant_phone,
    membership_tier, fee_amount, status,
    payment_deadline_at, payment_received_at,
    expected_depositor_name, actual_depositor_name,
    privacy_consent_at
  ) VALUES (
    p_event_id, p_team_id, p_user_id,
    v_profile.name, v_profile.student_id, v_profile.phone,
    v_tier, v_fee, v_status,
    CASE WHEN p_mark_paid THEN NULL ELSE now() + (v_event.payment_deadline_hours || ' hours')::interval END,
    v_received,
    v_depositor, p_actual_depositor_name,
    now()
  ) RETURNING id INTO v_reg_id;

  INSERT INTO public.event_payment_logs (registration_id, action, amount, note, performed_by)
  VALUES (
    v_reg_id,
    CASE WHEN p_mark_paid THEN 'mark_paid' ELSE 'register_admin' END,
    v_fee, p_note, auth.uid()
  );

  RETURN v_reg_id;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_cancel_admin
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_cancel_admin(p_registration_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_reg public.event_registrations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_reg FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_not_found'; END IF;

  UPDATE public.event_registrations
    SET status = 'cancelled_admin',
        cancelled_at = now(),
        cancel_reason = p_reason
    WHERE id = p_registration_id;

  INSERT INTO public.event_payment_logs (registration_id, action, amount, note, performed_by)
  VALUES (p_registration_id, 'cancel', v_reg.fee_amount, p_reason, auth.uid());
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_cancel_my_registration
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_cancel_my_registration(p_registration_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_reg public.event_registrations%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT * INTO v_reg FROM public.event_registrations
    WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_not_found'; END IF;
  IF v_reg.user_id != v_user_id THEN RAISE EXCEPTION 'not_owner'; END IF;
  IF v_reg.status NOT IN ('pending','paid','waitlisted') THEN
    RAISE EXCEPTION 'cannot_cancel_in_status';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_reg.event_id;
  IF v_event.event_start_at <= now() THEN
    RAISE EXCEPTION 'event_already_started';
  END IF;

  UPDATE public.event_registrations
    SET status = 'cancelled_self',
        cancelled_at = now(),
        cancel_reason = p_reason
    WHERE id = p_registration_id;

  -- 팀장이 취소하면 팀 status를 cancelled로 변경 (팀원도 모두 취소될지는 운영판단)
  IF v_reg.team_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.event_teams WHERE id = v_reg.team_id AND leader_user_id = v_user_id) THEN
      UPDATE public.event_teams SET status = 'cancelled' WHERE id = v_reg.team_id;
    END IF;
  END IF;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_check_in
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_check_in(p_registration_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.event_registrations
    SET checked_in_at = now()
    WHERE id = p_registration_id
      AND status = 'paid';
  IF NOT FOUND THEN RAISE EXCEPTION 'cannot_check_in'; END IF;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_create_team
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_create_team(p_event_id uuid, p_team_name text, p_size_target integer, p_extra_answers jsonb DEFAULT '{}'::jsonb, p_photo_consent boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_tier text;
  v_fee int;
  v_full bool;
  v_invite_code text;
  v_team_id uuid;
  v_reg_id uuid;
  v_depositor text;
  v_status text;
  v_deadline timestamptz;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF length(COALESCE(p_extra_answers::text,'')) > 4096 THEN
    RAISE EXCEPTION 'extra_answers_too_large';
  END IF;
  IF p_team_name IS NULL OR btrim(p_team_name) = '' THEN RAISE EXCEPTION 'team_name_required'; END IF;
  IF length(p_team_name) > 50 THEN RAISE EXCEPTION 'team_name_too_long'; END IF;
  IF p_size_target IS NULL OR p_size_target < 1 THEN RAISE EXCEPTION 'team_size_invalid'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_deleted'; END IF;
  IF v_event.status != 'recruiting' THEN RAISE EXCEPTION 'event_not_recruiting'; END IF;
  IF now() < v_event.recruit_start_at OR now() > v_event.recruit_end_at THEN
    RAISE EXCEPTION 'event_recruit_window_closed';
  END IF;
  IF v_event.participation_mode = 'individual' THEN
    RAISE EXCEPTION 'event_individual_only';
  END IF;
  IF v_event.team_size_min IS NOT NULL AND p_size_target < v_event.team_size_min THEN
    RAISE EXCEPTION 'team_size_below_min';
  END IF;
  IF v_event.team_size_max IS NOT NULL AND p_size_target > v_event.team_size_max THEN
    RAISE EXCEPTION 'team_size_above_max';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_registrations
             WHERE event_id = p_event_id AND user_id = v_user_id
               AND status NOT IN ('cancelled_unpaid','cancelled_self','cancelled_admin','refunded'))
  THEN
    RAISE EXCEPTION 'duplicate_registration';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  v_tier := public.resolve_membership_tier(v_user_id);
  v_fee := public._event_calc_fee(v_event.pricing, v_tier);

  v_full := public._event_is_full(p_event_id);
  IF v_full THEN
    IF v_event.waitlist_enabled THEN
      v_status := 'waitlisted';
      v_deadline := NULL;
    ELSE
      RAISE EXCEPTION 'event_full';
    END IF;
  ELSE
    v_status := 'pending';
    v_deadline := now() + (v_event.payment_deadline_hours || ' hours')::interval;
  END IF;

  v_invite_code := public._event_generate_invite_code();

  INSERT INTO public.event_teams (event_id, team_name, invite_code, leader_user_id, size_target)
  VALUES (p_event_id, btrim(p_team_name), v_invite_code, v_user_id, p_size_target)
  RETURNING id INTO v_team_id;

  v_depositor := public._event_make_depositor_name(v_event.slug, v_profile.name);

  INSERT INTO public.event_registrations (
    event_id, team_id, user_id,
    applicant_name, applicant_student_id, applicant_phone,
    membership_tier, fee_amount, status,
    payment_deadline_at, expected_depositor_name,
    extra_answers, privacy_consent_at, photo_consent
  ) VALUES (
    p_event_id, v_team_id, v_user_id,
    v_profile.name, v_profile.student_id, v_profile.phone,
    v_tier, v_fee, v_status,
    v_deadline, v_depositor,
    COALESCE(p_extra_answers, '{}'::jsonb),
    CASE WHEN v_event.require_privacy_consent THEN now() ELSE NULL END,
    p_photo_consent
  ) RETURNING id INTO v_reg_id;

  RETURN jsonb_build_object(
    'team_id', v_team_id,
    'invite_code', v_invite_code,
    'registration_id', v_reg_id
  );
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_expire_unpaid
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_expire_unpaid(p_event_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_reg record;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  FOR v_reg IN
    SELECT id, fee_amount FROM public.event_registrations
    WHERE status = 'pending'
      AND payment_deadline_at IS NOT NULL
      AND payment_deadline_at < now()
      AND (p_event_id IS NULL OR event_id = p_event_id)
    FOR UPDATE
  LOOP
    UPDATE public.event_registrations
      SET status = 'cancelled_unpaid',
          cancelled_at = now(),
          cancel_reason = 'payment_deadline_exceeded'
      WHERE id = v_reg.id;

    INSERT INTO public.event_payment_logs (registration_id, action, amount, note, performed_by)
    VALUES (v_reg.id, 'expire_unpaid', v_reg.fee_amount, 'auto-expired', auth.uid());

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_invite_user
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_invite_user(p_event_id uuid, p_user_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_reg_id uuid;
  v_depositor text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_registrations
             WHERE event_id = p_event_id AND user_id = p_user_id
               AND status NOT IN ('cancelled_unpaid','cancelled_self','cancelled_admin','refunded'))
  THEN
    RAISE EXCEPTION 'duplicate_registration';
  END IF;

  v_depositor := public._event_make_depositor_name(v_event.slug, v_profile.name);

  INSERT INTO public.event_registrations (
    event_id, team_id, user_id,
    applicant_name, applicant_student_id, applicant_phone,
    membership_tier, fee_amount, is_invited, status,
    expected_depositor_name,
    privacy_consent_at
  ) VALUES (
    p_event_id, NULL, p_user_id,
    v_profile.name, v_profile.student_id, v_profile.phone,
    'invited', 0, true, 'paid',
    v_depositor,
    now()
  ) RETURNING id INTO v_reg_id;

  INSERT INTO public.event_payment_logs (registration_id, action, amount, note, performed_by)
  VALUES (v_reg_id, 'invite', 0, p_note, auth.uid());

  RETURN v_reg_id;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_join_team
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_join_team(p_invite_code text, p_extra_answers jsonb DEFAULT '{}'::jsonb, p_photo_consent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_team public.event_teams%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_tier text;
  v_fee int;
  v_member_count int;
  v_reg_id uuid;
  v_depositor text;
  v_status text;
  v_deadline timestamptz;
  v_full bool;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF length(COALESCE(p_extra_answers::text,'')) > 4096 THEN
    RAISE EXCEPTION 'extra_answers_too_large';
  END IF;

  SELECT * INTO v_team FROM public.event_teams
    WHERE invite_code = upper(btrim(p_invite_code)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'team_not_found'; END IF;
  IF v_team.status != 'forming' THEN RAISE EXCEPTION 'team_closed'; END IF;

  -- [PATCH] events도 FOR UPDATE 잠금
  SELECT * INTO v_event FROM public.events WHERE id = v_team.event_id FOR UPDATE;
  IF v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_deleted'; END IF;
  IF v_event.status != 'recruiting' THEN RAISE EXCEPTION 'event_not_recruiting'; END IF;
  IF now() > v_event.recruit_end_at THEN RAISE EXCEPTION 'event_recruit_window_closed'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_registrations
             WHERE event_id = v_team.event_id AND user_id = v_user_id
               AND status NOT IN ('cancelled_unpaid','cancelled_self','cancelled_admin','refunded'))
  THEN
    RAISE EXCEPTION 'duplicate_registration';
  END IF;

  SELECT count(*) INTO v_member_count FROM public.event_registrations
    WHERE team_id = v_team.id
      AND status NOT IN ('cancelled_unpaid','cancelled_self','cancelled_admin','refunded');
  IF v_member_count >= v_team.size_target THEN RAISE EXCEPTION 'team_full'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  v_tier := public.resolve_membership_tier(v_user_id);
  v_fee := public._event_calc_fee(v_event.pricing, v_tier);
  v_depositor := public._event_make_depositor_name(v_event.slug, v_profile.name);

  -- [PATCH] 행사 전체 정원 체크 (capacity_unit=person 기준에서 의미; team이면 팀 단위라 신규 인원 추가는 영향 없음)
  IF v_event.capacity_unit = 'person' THEN
    v_full := public._event_is_full(v_team.event_id);
    IF v_full THEN
      IF v_event.waitlist_enabled THEN
        v_status := 'waitlisted';
        v_deadline := NULL;
      ELSE
        RAISE EXCEPTION 'event_full';
      END IF;
    ELSE
      v_status := 'pending';
      v_deadline := now() + (v_event.payment_deadline_hours || ' hours')::interval;
    END IF;
  ELSE
    -- 팀 단위 정원이면 팀 자체는 이미 등록 시점에 정원 체크됨 → 신규 팀원은 항상 pending
    v_status := 'pending';
    v_deadline := now() + (v_event.payment_deadline_hours || ' hours')::interval;
  END IF;

  INSERT INTO public.event_registrations (
    event_id, team_id, user_id,
    applicant_name, applicant_student_id, applicant_phone,
    membership_tier, fee_amount, status,
    payment_deadline_at, expected_depositor_name,
    extra_answers, privacy_consent_at, photo_consent
  ) VALUES (
    v_team.event_id, v_team.id, v_user_id,
    v_profile.name, v_profile.student_id, v_profile.phone,
    v_tier, v_fee, v_status,
    v_deadline, v_depositor,
    COALESCE(p_extra_answers, '{}'::jsonb),
    CASE WHEN v_event.require_privacy_consent THEN now() ELSE NULL END,
    p_photo_consent
  ) RETURNING id INTO v_reg_id;

  IF v_member_count + 1 >= v_team.size_target THEN
    UPDATE public.event_teams SET status = 'complete' WHERE id = v_team.id;
  END IF;

  RETURN v_reg_id;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_mark_paid
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_mark_paid(p_registration_id uuid, p_actual_depositor_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_reg public.event_registrations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_reg FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_not_found'; END IF;
  IF v_reg.status NOT IN ('pending','paid') THEN
    RAISE EXCEPTION 'cannot_mark_paid_in_status';
  END IF;

  UPDATE public.event_registrations
    SET status = 'paid',
        payment_received_at = now(),
        actual_depositor_name = COALESCE(p_actual_depositor_name, actual_depositor_name)
    WHERE id = p_registration_id;

  INSERT INTO public.event_payment_logs (registration_id, action, amount, note, performed_by)
  VALUES (p_registration_id, 'mark_paid', v_reg.fee_amount, p_note, auth.uid());
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_promote_waitlist
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_promote_waitlist(p_registration_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reg public.event_registrations%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_reg FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_not_found'; END IF;
  IF v_reg.status != 'waitlisted' THEN RAISE EXCEPTION 'not_waitlisted'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_reg.event_id;

  UPDATE public.event_registrations
    SET status = 'pending',
        payment_deadline_at = now() + (v_event.payment_deadline_hours || ' hours')::interval
    WHERE id = p_registration_id;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_refund
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_refund(p_registration_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_reg public.event_registrations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_reg FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_not_found'; END IF;
  IF v_reg.status != 'paid' THEN RAISE EXCEPTION 'not_paid_status'; END IF;

  UPDATE public.event_registrations
    SET status = 'refunded',
        cancelled_at = now(),
        cancel_reason = p_note
    WHERE id = p_registration_id;

  INSERT INTO public.event_payment_logs (registration_id, action, amount, note, performed_by)
  VALUES (p_registration_id, 'refund', v_reg.fee_amount, p_note, auth.uid());
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_register_individual
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_register_individual(p_event_id uuid, p_extra_answers jsonb DEFAULT '{}'::jsonb, p_photo_consent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_tier text;
  v_fee int;
  v_full bool;
  v_status text;
  v_deadline timestamptz;
  v_reg_id uuid;
  v_depositor text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF length(COALESCE(p_extra_answers::text,'')) > 4096 THEN
    RAISE EXCEPTION 'extra_answers_too_large';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_deleted'; END IF;
  IF v_event.status != 'recruiting' THEN RAISE EXCEPTION 'event_not_recruiting'; END IF;
  IF now() < v_event.recruit_start_at OR now() > v_event.recruit_end_at THEN
    RAISE EXCEPTION 'event_recruit_window_closed';
  END IF;
  IF v_event.participation_mode = 'team' THEN
    RAISE EXCEPTION 'event_team_only';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_registrations
             WHERE event_id = p_event_id AND user_id = v_user_id
               AND status NOT IN ('cancelled_unpaid','cancelled_self','cancelled_admin','refunded'))
  THEN
    RAISE EXCEPTION 'duplicate_registration';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  v_tier := public.resolve_membership_tier(v_user_id);
  v_fee := public._event_calc_fee(v_event.pricing, v_tier);

  v_full := public._event_is_full(p_event_id);
  IF v_full THEN
    IF v_event.waitlist_enabled THEN
      v_status := 'waitlisted';
      v_deadline := NULL;
    ELSE
      RAISE EXCEPTION 'event_full';
    END IF;
  ELSE
    v_status := 'pending';
    v_deadline := now() + (v_event.payment_deadline_hours || ' hours')::interval;
  END IF;

  v_depositor := public._event_make_depositor_name(v_event.slug, v_profile.name);

  INSERT INTO public.event_registrations (
    event_id, team_id, user_id,
    applicant_name, applicant_student_id, applicant_phone,
    membership_tier, fee_amount, status,
    payment_deadline_at, expected_depositor_name,
    extra_answers, privacy_consent_at, photo_consent
  ) VALUES (
    p_event_id, NULL, v_user_id,
    v_profile.name, v_profile.student_id, v_profile.phone,
    v_tier, v_fee, v_status,
    v_deadline, v_depositor,
    COALESCE(p_extra_answers, '{}'::jsonb),
    CASE WHEN v_event.require_privacy_consent THEN now() ELSE NULL END,
    p_photo_consent
  ) RETURNING id INTO v_reg_id;

  RETURN v_reg_id;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: event_unmark_paid
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_unmark_paid(p_registration_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_reg public.event_registrations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_reg FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_not_found'; END IF;
  IF v_reg.status != 'paid' THEN RAISE EXCEPTION 'not_paid_status'; END IF;

  UPDATE public.event_registrations
    SET status = 'pending',
        payment_received_at = NULL
    WHERE id = p_registration_id;

  INSERT INTO public.event_payment_logs (registration_id, action, amount, note, performed_by)
  VALUES (p_registration_id, 'unmark_paid', v_reg.fee_amount, p_note, auth.uid());
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
-- 함수: get_games_with_rentals
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_games_with_rentals()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(g.*) || jsonb_build_object(
    'rentals', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rental_id', r.rental_id,
            'game_id', r.game_id,
            'user_id', r.user_id,
            'renter_name', r.renter_name,
            'type', r.type,
            'returned_at', r.returned_at,
            'due_date', r.due_date,
            'borrowed_at', r.borrowed_at,
            'profiles', CASE
              WHEN p.id IS NOT NULL THEN jsonb_build_object('name', p.name)
              ELSE NULL
            END
          )
          ORDER BY r.borrowed_at
        )
        FROM public.rentals r
        LEFT JOIN public.profiles p ON p.id = r.user_id
        WHERE r.game_id = g.id
          AND r.returned_at IS NULL
      ),
      '[]'::jsonb
    )
  )
  FROM public.games g
  ORDER BY g.name;
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
-- 함수: get_overdue_stats
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_overdue_stats(p_days integer DEFAULT 90)
 RETURNS TABLE(total_rentals bigint, overdue_count bigint, overdue_rate numeric, avg_overdue_hours numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
    IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'p_days는 1~365 범위여야 합니다.'; END IF;

    RETURN QUERY
    SELECT COUNT(*),
        COUNT(*) FILTER (WHERE returned_at > due_date),
        ROUND((COUNT(*) FILTER (WHERE returned_at > due_date)::numeric / NULLIF(COUNT(*), 0)) * 100, 1),
        ROUND(AVG(CASE WHEN returned_at > due_date THEN EXTRACT(EPOCH FROM (returned_at - due_date)) / 3600 END)::numeric, 1)
    FROM public.rentals
    WHERE type = 'RENT' AND returned_at IS NOT NULL
      AND borrowed_at >= now() - (p_days || ' days')::interval;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: get_popular_searches
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_popular_searches(p_limit integer DEFAULT 20, p_days integer DEFAULT 30)
 RETURNS TABLE(query text, search_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
    IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'p_days는 1~365 범위여야 합니다.'; END IF;
    IF p_limit <= 0 OR p_limit > 100 THEN RAISE EXCEPTION 'p_limit는 1~100 범위여야 합니다.'; END IF;

    RETURN QUERY
    SELECT (details->>'query') AS query, COUNT(*) AS search_count
    FROM public.logs
    WHERE action_type = 'SEARCH'
      AND created_at >= now() - (p_days || ' days')::interval
      AND details->>'query' IS NOT NULL
    GROUP BY details->>'query'
    ORDER BY search_count DESC
    LIMIT p_limit;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: get_rental_source_breakdown
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rental_source_breakdown(p_days integer DEFAULT 30)
 RETURNS TABLE(source text, count bigint, ratio numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
    IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'p_days는 1~365 범위여야 합니다.'; END IF;

    RETURN QUERY
    SELECT COALESCE(r.source, 'admin'), COUNT(*),
        ROUND((COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0)) * 100, 1)
    FROM public.rentals r
    WHERE r.type = 'RENT' AND r.borrowed_at >= now() - (p_days || ' days')::interval
    GROUP BY r.source
    ORDER BY count DESC;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: get_rental_stats
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rental_stats(p_days integer DEFAULT 30)
 RETURNS TABLE(date date, rent_count bigint, return_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
    IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'p_days는 1~365 범위여야 합니다.'; END IF;

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(current_date - (p_days - 1), current_date, '1 day'::interval)::date AS d
    ),
    rents AS (
        SELECT borrowed_at::date AS d, COUNT(*) AS cnt
        FROM public.rentals
        WHERE type = 'RENT' AND borrowed_at >= current_date - (p_days - 1)
        GROUP BY borrowed_at::date
    ),
    returns AS (
        SELECT returned_at::date AS d, COUNT(*) AS cnt
        FROM public.rentals
        WHERE returned_at IS NOT NULL AND returned_at >= current_date - (p_days - 1)
        GROUP BY returned_at::date
    )
    SELECT ds.d, COALESCE(r.cnt, 0), COALESCE(rt.cnt, 0)
    FROM date_series ds
    LEFT JOIN rents r ON ds.d = r.d
    LEFT JOIN returns rt ON ds.d = rt.d
    ORDER BY ds.d;
END;
$function$

-- ----------------------------------------------------------------
-- 함수: get_top_rented_games
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_top_rented_games(p_limit integer DEFAULT 10, p_days integer DEFAULT 90)
 RETURNS TABLE(game_id integer, game_name text, rent_count bigint, avg_duration_hours numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
    IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'p_days는 1~365 범위여야 합니다.'; END IF;
    IF p_limit <= 0 OR p_limit > 100 THEN RAISE EXCEPTION 'p_limit는 1~100 범위여야 합니다.'; END IF;

    RETURN QUERY
    SELECT r.game_id, r.game_name, COUNT(*) AS rent_count,
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(r.returned_at, now()) - r.borrowed_at)) / 3600)::numeric, 1)
    FROM public.rentals r
    WHERE r.type = 'RENT' AND r.borrowed_at >= now() - (p_days || ' days')::interval
    GROUP BY r.game_id, r.game_name
    ORDER BY rent_count DESC
    LIMIT p_limit;
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
-- 함수: ingest_rental_request
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_rental_request(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_expected_secret text;
    v_secret          text;

    v_submitted_at    timestamptz;
    v_requester_name  text;
    v_requester_phone text;
    v_games_raw       text;
    v_game_count_raw  text;
    v_duration_raw    text;
    v_pickup_raw      text;

    v_is_free         boolean;
    v_matched_ids     int[];
    v_pickup_at       timestamptz;
    v_duration_days   int;
    v_fee             int;
    v_game_count      int;

    v_request_id      uuid;
    v_auto_ok         boolean;

    v_gid             int;
    v_hold_ids        uuid[] := '{}';
    v_hold_id         uuid;
    v_note            text;
    v_borrowed_at     timestamptz;
    v_due_date        timestamptz;
    v_quantity        int;
    v_conflict_count  int;
    v_any_conflict    boolean := false;
    v_status          text;
    v_dup_id          uuid;
BEGIN
    -- 1) 시크릿 검증
    SELECT value INTO v_expected_secret
    FROM public.private_config
    WHERE key = 'gas_shared_secret';

    v_secret := p_payload->>'_secret';

    IF v_expected_secret IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '서버 시크릿 미설정');
    END IF;
    IF v_secret IS NULL OR v_secret <> v_expected_secret THEN
        RETURN jsonb_build_object('success', false, 'message', '인증 실패');
    END IF;

    -- 2) 필드 추출
    v_submitted_at := COALESCE(
        (p_payload->>'submitted_at')::timestamptz,
        now()
    );
    v_requester_name  := btrim(COALESCE(p_payload->>'requester_name', ''));
    v_requester_phone := btrim(COALESCE(p_payload->>'requester_phone', ''));
    v_games_raw       := btrim(COALESCE(p_payload->>'requested_games_raw', ''));
    v_game_count_raw  := COALESCE(p_payload->>'game_count_raw', '');
    v_duration_raw    := COALESCE(p_payload->>'rental_duration_raw', '');
    v_pickup_raw      := COALESCE(p_payload->>'pickup_raw', '');

    IF v_requester_name = '' OR v_requester_phone = '' OR v_games_raw = '' THEN
        RETURN jsonb_build_object('success', false, 'message', '필수 필드 누락');
    END IF;

    -- 3) dedupe: 같은 제출시각+전화+게임원문 3중 일치 → 기존 id 반환
    SELECT id INTO v_dup_id
    FROM public.rental_requests
    WHERE submitted_at = v_submitted_at
      AND requester_phone = v_requester_phone
      AND requested_games_raw = v_games_raw
    LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'request_id', v_dup_id
        );
    END IF;

    -- 4) 파싱
    v_is_free := (
        COALESCE(btrim(p_payload->>'org_name'), '') <> ''
        AND COALESCE(btrim(p_payload->>'event_overview'), '') <> ''
        AND COALESCE(btrim(p_payload->>'event_schedule'), '') <> ''
        AND COALESCE(btrim(p_payload->>'audience_notes'), '') <> ''
    );
    v_matched_ids   := public._fuzzy_match_games(v_games_raw);
    v_pickup_at     := public._parse_pickup(v_pickup_raw);
    v_duration_days := public._parse_duration(v_duration_raw);
    v_fee           := public._parse_fee(v_game_count_raw);
    v_game_count    := public._parse_game_count(v_game_count_raw);

    -- 요청된 토큰 수 (comma-split 기준, 공백 토큰 제외)
    IF v_game_count IS NULL THEN
        SELECT COUNT(*) INTO v_game_count
        FROM unnest(string_to_array(v_games_raw, ',')) t
        WHERE btrim(t) <> '';
    END IF;

    -- 5) rental_requests INSERT
    INSERT INTO public.rental_requests (
        submitted_at, requester_name, requester_phone,
        org_type, org_name, event_overview, event_schedule, audience_notes,
        requested_games_raw, game_count, rental_fee, rental_duration_raw, pickup_raw,
        is_free, matched_game_ids, pickup_at, duration_days,
        status, raw_payload
    ) VALUES (
        v_submitted_at, v_requester_name, v_requester_phone,
        p_payload->>'org_type', p_payload->>'org_name',
        p_payload->>'event_overview', p_payload->>'event_schedule', p_payload->>'audience_notes',
        v_games_raw, v_game_count, v_fee, v_duration_raw, v_pickup_raw,
        v_is_free, COALESCE(v_matched_ids, '{}'), v_pickup_at, v_duration_days,
        'pending', p_payload
    ) RETURNING id INTO v_request_id;

    -- 6) 자동 확정 판정
    v_auto_ok := (
        v_matched_ids IS NOT NULL
        AND array_length(v_matched_ids, 1) = v_game_count
        AND v_game_count > 0
        AND v_pickup_at IS NOT NULL
        AND v_duration_days IS NOT NULL
        AND v_pickup_at > now()
    );

    IF v_auto_ok THEN
        v_borrowed_at := v_pickup_at - interval '24 hours';
        v_due_date    := v_pickup_at + (v_duration_days || ' days')::interval;
        v_note        := 'HOLD request:' || v_request_id::text;

        -- 게임별 HOLD 생성 + 재고 충돌 검사
        FOR v_gid IN SELECT unnest(v_matched_ids) LOOP
            SELECT quantity INTO v_quantity
            FROM public.games WHERE id = v_gid FOR UPDATE;

            -- 해당 기간 겹치는 active 대여/HOLD 수
            SELECT COUNT(*) INTO v_conflict_count
            FROM public.rentals
            WHERE game_id = v_gid
              AND returned_at IS NULL
              AND (
                  type = 'RENT'
                  OR (type = 'DIBS' AND due_date > now())
                  OR (type = 'HOLD' AND due_date > now())
              )
              AND tstzrange(borrowed_at, due_date, '[)')
                  && tstzrange(v_borrowed_at, v_due_date, '[)');

            IF v_conflict_count >= v_quantity THEN
                v_any_conflict := true;
            END IF;

            INSERT INTO public.rentals (
                game_id, user_id, game_name, renter_name, type,
                borrowed_at, due_date, source, note
            )
            SELECT v_gid, NULL, g.name, v_requester_name, 'HOLD',
                   v_borrowed_at, v_due_date, 'form', v_note
            FROM public.games g WHERE g.id = v_gid
            RETURNING rental_id INTO v_hold_id;

            v_hold_ids := array_append(v_hold_ids, v_hold_id);

            -- 7일 lookahead 창이면 재고 차감
            IF v_borrowed_at <= now() + interval '7 days' AND v_due_date > now() THEN
                UPDATE public.games
                SET available_count = GREATEST(0, COALESCE(available_count, 0) - 1)
                WHERE id = v_gid;
            END IF;
        END LOOP;

        IF v_any_conflict THEN
            v_status := 'needs_review';
            -- 충돌 발생 시에도 HOLD는 이미 INSERT됨 — 관리자 검토로 회귀
            UPDATE public.rental_requests
            SET status = v_status,
                hold_rental_ids = v_hold_ids,
                review_note = '재고 충돌 감지 — 관리자 확인 필요'
            WHERE id = v_request_id;
        ELSE
            v_status := 'auto_confirmed';
            UPDATE public.rental_requests
            SET status = v_status, hold_rental_ids = v_hold_ids
            WHERE id = v_request_id;
        END IF;
    ELSE
        v_status := 'needs_review';
        UPDATE public.rental_requests
        SET status = v_status
        WHERE id = v_request_id;
    END IF;

    -- 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (
        NULL, NULL, 'RENTAL_REQUEST_INGEST',
        jsonb_build_object(
            'request_id', v_request_id,
            'status', v_status,
            'matched', COALESCE(array_length(v_matched_ids, 1), 0),
            'requested_count', v_game_count
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'request_id', v_request_id,
        'status', v_status
    );
END;
$function$

-- ----------------------------------------------------------------
-- 함수: is_admin
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role_key IN ('admin', 'executive')
  );
END;
$function$

-- ----------------------------------------------------------------
-- 함수: is_event_team_leader
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_event_team_leader(p_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM event_teams
    WHERE id = p_team_id AND leader_user_id = auth.uid()
  );
$function$

-- ----------------------------------------------------------------
-- 함수: is_event_team_member
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_event_team_member(p_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM event_registrations
    WHERE team_id = p_team_id AND user_id = auth.uid()
  );
$function$

-- ----------------------------------------------------------------
-- 함수: is_kiosk_or_admin
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_kiosk_or_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
    IF NOT public.is_kiosk_or_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 필요합니다.');
    END IF;
    SELECT game_id, user_id, type INTO v_game_id, v_user_id, v_type FROM public.rentals WHERE rental_id = p_rental_id;
    IF v_type != 'DIBS' THEN RETURN jsonb_build_object('success', false, 'message', '예약 상태가 아닙니다.'); END IF;
    UPDATE public.rentals SET type = 'RENT', borrowed_at = now(), due_date = now() + interval '2 days', source = 'kiosk' WHERE rental_id = p_rental_id;
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
    IF NOT public.is_kiosk_or_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 필요합니다.');
    END IF;

    IF is_payment_check_enabled() AND NOT is_user_payment_exempt(p_user_id) THEN
        IF NOT COALESCE((SELECT is_paid FROM public.profiles WHERE id = p_user_id), false) THEN
            RETURN jsonb_build_object('success', false, 'message', '회비 납부가 필요합니다.');
        END IF;
    END IF;

    SELECT name, quantity INTO v_game_name, v_quantity
    FROM public.games WHERE id = p_game_id FOR UPDATE;

    SELECT COUNT(*) INTO v_active_count
    FROM public.rentals
    WHERE game_id = p_game_id
      AND returned_at IS NULL
      AND (
          type = 'RENT'
          OR (type = 'DIBS' AND due_date > now())
          OR (type = 'HOLD'
              AND borrowed_at <= now() + interval '7 days'
              AND due_date > now())
      );

    IF v_quantity - v_active_count <= 0 THEN
        UPDATE public.games SET available_count = 0 WHERE id = p_game_id;
        RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
    END IF;

    UPDATE public.games
    SET available_count = (v_quantity - v_active_count) - 1
    WHERE id = p_game_id;

    INSERT INTO public.rentals (game_id, user_id, game_name, type, borrowed_at, due_date, source)
    VALUES (p_game_id, p_user_id, v_game_name, 'RENT', now(), now() + interval '2 days', 'kiosk');

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
DECLARE
    v_rental_id    UUID;
    v_game_name    TEXT;
    v_game_id      INTEGER;
    v_quantity     INTEGER;
    v_active_count INTEGER;
BEGIN
    IF NOT public.is_kiosk_or_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 필요합니다.');
    END IF;

    IF p_rental_id IS NOT NULL THEN
        SELECT rental_id, game_name, game_id
        INTO   v_rental_id, v_game_name, v_game_id
        FROM   public.rentals
        WHERE  rental_id   = p_rental_id
          AND  returned_at IS NULL
          AND  type        = 'RENT';
    ELSE
        SELECT rental_id, game_name, game_id
        INTO   v_rental_id, v_game_name, v_game_id
        FROM   public.rentals
        WHERE  game_id     = p_game_id
          AND  user_id     = p_user_id
          AND  returned_at IS NULL
          AND  type        = 'RENT'
        LIMIT 1;
    END IF;

    IF v_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 기록이 없습니다.');
    END IF;

    v_game_id := COALESCE(v_game_id, p_game_id);

    UPDATE public.rentals SET returned_at = now() WHERE rental_id = v_rental_id;

    SELECT quantity INTO v_quantity FROM public.games WHERE id = v_game_id;
    SELECT COUNT(*) INTO v_active_count
    FROM   public.rentals
    WHERE  game_id     = v_game_id
      AND  returned_at IS NULL
      AND  (
          type = 'RENT'
          OR (type = 'DIBS' AND due_date > now())
          OR (type = 'HOLD'
              AND borrowed_at <= now() + interval '7 days'
              AND due_date > now())
      );
    UPDATE public.games SET available_count = v_quantity - v_active_count WHERE id = v_game_id;

    IF p_user_id IS NOT NULL THEN
        PERFORM public.earn_points(
            p_user_id,
            50,
            'RETURN_ON_TIME',
            '제때 반납 보상'
        );
    END IF;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (v_game_id, p_user_id, 'RETURN', to_jsonb('Kiosk Return'::text));

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
-- 함수: reject_rental_request
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_rental_request(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_req        public.rental_requests%ROWTYPE;
    v_hold_id    uuid;
    v_game_id    int;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    SELECT * INTO v_req FROM public.rental_requests WHERE id = p_request_id;
    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '요청을 찾을 수 없습니다.');
    END IF;
    IF v_req.status IN ('rejected', 'cancelled') THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 처리된 요청입니다.');
    END IF;

    -- 연결된 HOLD가 있으면 반납 마킹 + 재고 복원
    IF v_req.hold_rental_ids IS NOT NULL AND array_length(v_req.hold_rental_ids, 1) > 0 THEN
        FOR v_hold_id IN SELECT unnest(v_req.hold_rental_ids) LOOP
            SELECT game_id INTO v_game_id
            FROM public.rentals
            WHERE rental_id = v_hold_id AND returned_at IS NULL;

            IF v_game_id IS NOT NULL THEN
                UPDATE public.rentals
                SET returned_at = now()
                WHERE rental_id = v_hold_id;

                -- available_count 재계산
                UPDATE public.games g
                SET available_count = GREATEST(
                    0,
                    g.quantity - COALESCE((
                        SELECT COUNT(*)
                        FROM public.rentals r
                        WHERE r.game_id = g.id
                          AND r.returned_at IS NULL
                          AND (
                              r.type = 'RENT'
                              OR (r.type = 'DIBS' AND r.due_date > now())
                              OR (r.type = 'HOLD'
                                  AND r.borrowed_at <= now() + interval '7 days'
                                  AND r.due_date > now())
                          )
                    ), 0)
                )
                WHERE g.id = v_game_id;
            END IF;
        END LOOP;
    END IF;

    UPDATE public.rental_requests
    SET status = 'rejected',
        review_note = p_reason,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (
        NULL, auth.uid(), 'RENTAL_REQUEST_REJECT',
        jsonb_build_object('request_id', p_request_id, 'reason', p_reason)
    );

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
    IF auth.uid() IS NULL OR (auth.uid() != p_user_id AND NOT public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;
    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;

    UPDATE public.rentals
    SET type = 'RENT', returned_at = NULL, borrowed_at = now(),
        due_date = now() + interval '7 days',
        renter_name = p_renter_name,
        source = 'app'
    WHERE game_id = p_game_id AND user_id = p_user_id AND type = 'DIBS' AND returned_at IS NULL;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 0 THEN
        UPDATE public.games SET available_count = available_count - 1
        WHERE id = p_game_id AND available_count > 0;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        IF v_affected = 0 THEN
            RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
        END IF;
        INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date, source)
        VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days', 'app');
    END IF;

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
-- 함수: resolve_membership_tier
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_membership_tier(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_is_paid bool;
BEGIN
  IF p_user_id IS NULL THEN RETURN 'non_member'; END IF;
  SELECT is_paid INTO v_is_paid FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN 'non_member'; END IF;
  IF v_is_paid THEN RETURN 'paid_member'; END IF;
  RETURN 'member';
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
-- 함수: set_private_config
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_private_config(p_key text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;
    INSERT INTO public.private_config (key, value, updated_at)
    VALUES (p_key, p_value, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
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
