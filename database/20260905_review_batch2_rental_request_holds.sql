-- ================================================================
-- 2026-09-05  RLS·RPC 검수 반영 2차 — 외부 신청 HOLD 확보·재확정 연결
-- 적용: mcp apply_migration (review_batch2_rental_request_holds)
-- ================================================================
--
-- 1) confirm_rental_request
--    자동 접수가 일부 게임만 확보하고 needs_review 로 넘긴 뒤 관리자가 수동 확정하면,
--    자기 신청의 HOLD 를 충돌로 세어 거절되거나, 재고가 넉넉하면 옛 HOLD 를 닫지 않은 채
--    새 HOLD 를 만들어 이중 점유 + 연결 끊긴 HOLD 가 생기던 구조.
--    → 충돌 계산에서 자기 HOLD 제외, 상태 선점 후 옛 HOLD 종료, 새 HOLD 생성, 빠진 게임까지 재계산.
--    순서가 중요: plpgsql 의 RETURN(실패 응답)은 롤백이 아니므로 옛 HOLD 종료는 검증·선점 뒤에.
-- 2) 중복 접수 유니크 인덱스 + ingest 의 unique_violation 처리
--    지금까지는 SELECT 확인만 있어 동시 재전송(Apps Script 재시도)에 취약했다.
--    인덱스로 막고, 걸리면 기존 id 를 duplicate 응답으로 돌려준다 (GAS 쪽 동작 변화 없음).

-- ---------------------------------------------------------------- 1) 수동 확정
CREATE OR REPLACE FUNCTION public.confirm_rental_request(p_request_id uuid, p_game_ids integer[], p_pickup_at timestamp with time zone, p_duration_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_req            public.rental_requests%ROWTYPE;
    v_gid            int;
    v_needed         int;
    v_quantity       int;
    v_game_name      text;
    v_conflict_count int;
    v_conflicts      text[] := '{}';
    v_hold_id        uuid;
    v_hold_ids       uuid[] := '{}';
    v_old_hold       uuid;
    v_old_gids       int[] := '{}';
    v_borrowed_at    timestamptz;
    v_due_date       timestamptz;
    v_note           text;
    v_claimed        int;
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

    -- [1패스] 게임별 락(id 오름차순) + 존재·기간 재고 검증
    --   자동 접수(needs_review)가 이미 확보해 둔 이 신청의 HOLD 는 충돌로 세지 않는다.
    --   (아래에서 닫고 새로 만들므로 점유가 이중으로 잡히지 않는다)
    --   주의: 여기서 실패해 RETURN 하면 앞선 UPDATE 도 커밋되므로, 옛 HOLD 종료는 검증·선점 뒤에 한다.
    FOR v_gid, v_needed IN
        SELECT t.gid, COUNT(*)::int FROM unnest(p_game_ids) AS t(gid) GROUP BY t.gid ORDER BY t.gid
    LOOP
        SELECT quantity, name INTO v_quantity, v_game_name
        FROM public.games WHERE id = v_gid FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임이 포함되어 있습니다. (id=' || v_gid || ')');
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
              && tstzrange(v_borrowed_at, v_due_date, '[)')
          AND NOT (rental_id = ANY(COALESCE(v_req.hold_rental_ids, '{}')))
          AND (note IS DISTINCT FROM v_note);

        IF v_conflict_count + v_needed > COALESCE(v_quantity, 0) THEN
            v_conflicts := array_append(v_conflicts, v_game_name);
        END IF;
    END LOOP;

    IF array_length(v_conflicts, 1) > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', '해당 기간에 재고가 부족한 게임: ' || array_to_string(v_conflicts, ', ') || ' — 게임 또는 기간을 조정해주세요.'
        );
    END IF;

    -- [선점] 크론 자동 반려·다른 관리자와의 경합 차단: 상태 조건부 전이가 성공한 쪽만 진행
    UPDATE public.rental_requests
    SET status = 'manual_confirmed',
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id AND status IN ('pending', 'needs_review');
    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    IF v_claimed = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 처리된 요청입니다. (동시 처리 감지)');
    END IF;

    -- [정리] 이 신청이 앞서 확보한 HOLD 는 전부 닫는다 (관리자가 게임·기간을 바꿨을 수 있다)
    FOR v_old_hold, v_gid IN
        SELECT r.rental_id, r.game_id FROM public.rentals r
        WHERE (r.rental_id = ANY(COALESCE(v_req.hold_rental_ids, '{}')) OR r.note = v_note)
          AND r.type = 'HOLD' AND r.returned_at IS NULL
        ORDER BY r.game_id
    LOOP
        PERFORM 1 FROM public.games WHERE id = v_gid FOR UPDATE;
        UPDATE public.rentals SET returned_at = now()
        WHERE rental_id = v_old_hold AND returned_at IS NULL;
        v_old_gids := array_append(v_old_gids, v_gid);
    END LOOP;

    -- [2패스] HOLD 생성 (중복 id = 복수 부수 유지, id 오름차순)
    FOR v_gid IN SELECT t.gid FROM unnest(p_game_ids) AS t(gid) ORDER BY t.gid LOOP
        INSERT INTO public.rentals (
            game_id, user_id, game_name, renter_name, type,
            borrowed_at, due_date, source, note
        )
        SELECT v_gid, NULL, g.name, v_req.requester_name, 'HOLD',
               v_borrowed_at, v_due_date, 'form', v_note
        FROM public.games g WHERE g.id = v_gid
        RETURNING rental_id INTO v_hold_id;

        v_hold_ids := array_append(v_hold_ids, v_hold_id);
    END LOOP;

    -- [재계산] 새 HOLD 게임 + 옛 HOLD 를 닫은 게임 (목록에서 빠진 게임 포함)
    FOR v_gid IN
        SELECT DISTINCT gid FROM unnest(p_game_ids || v_old_gids) AS t(gid) ORDER BY gid
    LOOP
        PERFORM public.recalc_game_availability(v_gid);
    END LOOP;

    UPDATE public.rental_requests
    SET matched_game_ids = p_game_ids,
        pickup_at = p_pickup_at,
        duration_days = p_duration_days,
        hold_rental_ids = v_hold_ids
    WHERE id = p_request_id;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (
        NULL, auth.uid(), 'RENTAL_REQUEST_CONFIRM',
        jsonb_build_object('request_id', p_request_id, 'hold_count', array_length(v_hold_ids, 1),
                           'closed_prior_holds', COALESCE(array_length(v_old_gids, 1), 0))
    );

    RETURN jsonb_build_object('success', true, 'hold_rental_ids', v_hold_ids);
END;
$function$;

-- ---------------------------------------------------------------- 2) 중복 접수 차단
CREATE UNIQUE INDEX IF NOT EXISTS rental_requests_dedupe_key
    ON public.rental_requests (submitted_at, requester_phone, requested_games_raw);

CREATE OR REPLACE FUNCTION public.ingest_rental_request(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    --    유니크 인덱스(rental_requests_dedupe_key)가 동시 재전송을 막는다.
    --    위 SELECT 검사와 INSERT 사이에 다른 트랜잭션이 먼저 커밋하면 unique_violation → 기존 id 반환
    BEGIN
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
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_dup_id
        FROM public.rental_requests
        WHERE submitted_at = v_submitted_at
          AND requester_phone = v_requester_phone
          AND requested_games_raw = v_games_raw
        LIMIT 1;
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'request_id', v_dup_id
        );
    END;

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
