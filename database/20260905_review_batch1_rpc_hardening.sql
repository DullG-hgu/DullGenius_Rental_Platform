-- ================================================================
-- 2026-09-05  RLS·RPC 검수 반영 1차
-- 적용: mcp apply_migration (review_batch1_rpc_hardening)
-- ================================================================
--
-- 1) rent_game / return_game — 회원이 키오스크·관리자 확인 없이 스스로 대여·반납하는 경로.
--    프론트 호출처 0곳, 최근 90일 로그 0건. DROP 대신 REVOKE 로 되돌릴 여지를 남긴다.
-- 2) ingest_rental_request — 인증에 쓴 공유 시크릿(_secret)이 raw_payload 에 그대로 저장되던 문제.
--    저장 시 키를 제거하고, 이미 저장된 행도 정리한다.
-- 3) admin_rent_game — 이미 전환된 찜 id 로 재호출하면 새 대여가 하나 더 생기던 문제.
--    만료 찜 → 새 대여 대체(데스크 흐름)는 유지하고, 중복만 막는다 (1인 1부 규칙 통일).
-- 4) get_rental_stats — 반납 집계에 찜·HOLD 종료가 섞이던 문제.

-- ---------------------------------------------------------------- 1) 회원 자가 대여·반납 경로 폐쇄
REVOKE EXECUTE ON FUNCTION public.rent_game(integer, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.return_game(integer, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 2) 시크릿 저장 차단
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
    v_needed          int;
    v_i               int;
    v_hold_ids        uuid[] := '{}';
    v_hold_id         uuid;
    v_note            text;
    v_borrowed_at     timestamptz;
    v_due_date        timestamptz;
    v_quantity        int;
    v_conflict_count  int;
    v_any_conflict    boolean := false;
    v_conflict_names  text[] := '{}';
    v_game_name       text;
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
        'pending', p_payload - '_secret'   -- 공유 시크릿은 인증에만 쓰고 원문에는 남기지 않는다
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

        -- 게임별(id 오름차순 락) 재고 검사 → 부족한 게임은 HOLD를 만들지 않는다 (재고 봉쇄 방지)
        FOR v_gid, v_needed IN
            SELECT t.gid, COUNT(*)::int FROM unnest(v_matched_ids) AS t(gid) GROUP BY t.gid ORDER BY t.gid
        LOOP
            SELECT quantity, name INTO v_quantity, v_game_name
            FROM public.games WHERE id = v_gid FOR UPDATE;
            IF NOT FOUND THEN
                v_any_conflict := true;
                CONTINUE;
            END IF;

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

            IF v_conflict_count + v_needed > COALESCE(v_quantity, 0) THEN
                v_any_conflict := true;
                v_conflict_names := array_append(v_conflict_names, v_game_name);
                CONTINUE;
            END IF;

            FOR v_i IN 1..v_needed LOOP
                INSERT INTO public.rentals (
                    game_id, user_id, game_name, renter_name, type,
                    borrowed_at, due_date, source, note
                )
                VALUES (v_gid, NULL, v_game_name, v_requester_name, 'HOLD',
                        v_borrowed_at, v_due_date, 'form', v_note)
                RETURNING rental_id INTO v_hold_id;

                v_hold_ids := array_append(v_hold_ids, v_hold_id);
            END LOOP;

            IF v_borrowed_at <= now() + interval '7 days' AND v_due_date > now() THEN
                PERFORM public.recalc_game_availability(v_gid);
            END IF;
        END LOOP;

        IF v_any_conflict THEN
            v_status := 'needs_review';
            UPDATE public.rental_requests
            SET status = v_status,
                hold_rental_ids = v_hold_ids,
                review_note = '재고 충돌 — HOLD 미생성 게임: '
                              || COALESCE(NULLIF(array_to_string(v_conflict_names, ', '), ''), '(매칭 실패 포함)')
                              || ' / 확보된 게임의 HOLD는 생성됨'
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
$function$;

-- 이미 저장된 원문에서 시크릿 제거
UPDATE public.rental_requests
SET raw_payload = raw_payload - '_secret'
WHERE raw_payload ? '_secret';

-- ---------------------------------------------------------------- 3) 관리자 대여 중복 차단
CREATE OR REPLACE FUNCTION public.admin_rent_game(p_game_id integer, p_renter_name text, p_user_id uuid DEFAULT NULL::uuid, p_rental_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_game_name  TEXT;
    v_quantity   INTEGER;
    v_affected   INTEGER;
    v_target_id  UUID;
    v_due        TIMESTAMPTZ;
    v_expired    BOOLEAN := false;
BEGIN
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '관리자 권한이 필요합니다.');
    END IF;

    SELECT name, quantity INTO v_game_name, v_quantity
    FROM public.games WHERE id = p_game_id FOR UPDATE;

    IF v_game_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;

    -- [중복 차단] 지정한 찜이 이미 대여로 전환돼 있으면(재시도·이중 클릭) 새 대여를 만들지 않는다
    IF p_rental_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.rentals
        WHERE rental_id = p_rental_id AND type = 'RENT' AND returned_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 대여 처리된 찜입니다.');
    END IF;

    -- [운영 방침] 같은 게임은 1인 1부 — rent_game/dibs_game 과 같은 규칙을 관리자 경로에도 적용
    IF p_user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND type = 'RENT' AND returned_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 대여 중인 게임입니다.');
    END IF;

    -- 대상 찜 선정. returned_at IS NULL 필수(부활 차단),
    -- 식별자가 전혀 없으면 남의 찜을 집지 않도록 매칭하지 않는다.
    IF p_rental_id IS NOT NULL THEN
        SELECT rental_id, due_date INTO v_target_id, v_due
        FROM public.rentals
        WHERE rental_id = p_rental_id AND game_id = p_game_id
          AND type = 'DIBS' AND returned_at IS NULL;
    ELSIF p_user_id IS NOT NULL THEN
        SELECT rental_id, due_date INTO v_target_id, v_due
        FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND type = 'DIBS' AND returned_at IS NULL
        ORDER BY due_date DESC
        LIMIT 1;
    ELSIF p_renter_name IS NOT NULL THEN
        SELECT rental_id, due_date INTO v_target_id, v_due
        FROM public.rentals
        WHERE game_id = p_game_id AND renter_name = p_renter_name
          AND type = 'DIBS' AND returned_at IS NULL
        ORDER BY due_date DESC
        LIMIT 1;
    END IF;

    IF v_target_id IS NOT NULL THEN
        v_expired := (v_due IS NULL OR v_due <= now());

        -- 만료된 찜은 점유에서 이미 빠져 있다 → 재고를 다시 확인해야 한다
        IF v_expired AND COALESCE(v_quantity, 0) - public.count_active_occupancy(p_game_id) <= 0 THEN
            PERFORM public.recalc_game_availability(p_game_id);
            RETURN jsonb_build_object('success', false, 'message', '찜이 만료되었고 남은 재고가 없습니다. 반납 후 진행해주세요.');
        END IF;

        UPDATE public.rentals
        SET type = 'RENT',
            borrowed_at = now(),
            due_date = now() + interval '7 days',
            renter_name = COALESCE(p_renter_name, renter_name),
            user_id = COALESCE(p_user_id, user_id),
            source = 'admin'
        WHERE rental_id = v_target_id
          AND type = 'DIBS' AND returned_at IS NULL;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
    ELSE
        v_affected := 0;
    END IF;

    IF v_affected = 0 THEN
        IF COALESCE(v_quantity, 0) - public.count_active_occupancy(p_game_id) <= 0 THEN
            PERFORM public.recalc_game_availability(p_game_id);
            RETURN jsonb_build_object('success', false, 'message', '재고가 없습니다.');
        END IF;

        INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type, borrowed_at, due_date, source)
        VALUES (p_game_id, p_user_id, v_game_name, p_renter_name, 'RENT', now(), now() + interval '7 days', 'admin');
    END IF;

    PERFORM public.recalc_game_availability(p_game_id);

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT',
            jsonb_build_object('action', 'ADMIN RENT', 'renter', p_renter_name,
                               'from_expired_dibs', v_expired AND v_affected > 0));

    RETURN jsonb_build_object('success', true, 'message', '대여 완료');
END;
$function$;

-- ---------------------------------------------------------------- 4) 반납 통계 RENT 한정
CREATE OR REPLACE FUNCTION public.get_rental_stats(p_days integer DEFAULT 30)
 RETURNS TABLE(date date, rent_count bigint, return_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
    IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'p_days는 1~365 범위여야 합니다.'; END IF;

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(current_date - (p_days - 1), current_date, '1 day'::interval)::date AS d
    ),
    rents AS (
        SELECT r.borrowed_at::date AS d, COUNT(*) AS cnt
        FROM public.rentals r
        WHERE r.type = 'RENT' AND r.borrowed_at >= current_date - (p_days - 1)
          AND NOT EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = r.user_id AND ur.role_key = 'tester'
          )
        GROUP BY r.borrowed_at::date
    ),
    returns AS (
        SELECT r.returned_at::date AS d, COUNT(*) AS cnt
        FROM public.rentals r
        WHERE r.type = 'RENT'   -- 찜·HOLD 종료(returned_at)는 반납이 아니다
          AND r.returned_at IS NOT NULL AND r.returned_at >= current_date - (p_days - 1)
          AND NOT EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = r.user_id AND ur.role_key = 'tester'
          )
        GROUP BY r.returned_at::date
    )
    SELECT ds.d, COALESCE(rn.cnt, 0), COALESCE(rt.cnt, 0)
    FROM date_series ds
    LEFT JOIN rents rn ON ds.d = rn.d
    LEFT JOIN returns rt ON ds.d = rt.d
    ORDER BY ds.d;
END;
$function$;
