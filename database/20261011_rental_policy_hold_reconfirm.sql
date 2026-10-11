-- 2026-10-11 confirm_rental_request: 확정된 단체 대여 신청의 재확정(게임·날짜 변경) 허용 — G1
-- 2026-10-11 운영 적용 (마이그레이션 20261011_confirm_rental_request_reconfirm)
--
-- 문제: 관리자 「검토·수정」이 auto_confirmed 에도 뜨지만(RentalRequestsTab.jsx:123)
--       이 함수가 pending·needs_review 만 받아 항상 「이미 처리된 요청입니다」로 실패했다.
-- 변경:
--   1) 허용 상태에 auto_confirmed·manual_confirmed 추가. 재확정 결과 상태는 manual_confirmed.
--   2) 신청 행 FOR UPDATE — 같은 신청을 두 관리자가 동시에 재확정해 HOLD 가 이중 생성되는 경합 차단.
--   3) 확정 건은 열린 HOLD 가 하나 이상일 때만 재확정 (기한이 지나 닫힌 대여를 되살리지 않는다).
--   4) 선점 UPDATE 조건을 「읽은 상태 그대로일 때」로 (그 사이 반려·크론 자동 반려 감지).
-- 그대로: 충돌 검사는 이미 이 신청의 HOLD(hold_rental_ids 또는 note 일치)를 제외한다.
--   옛 HOLD 종료 → 새 HOLD 생성 → 재계산 흐름, 시그니처, 반환 형식.
-- app_config 값은 건드리지 않는다.

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
    v_open_holds     int;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    -- 신청 행을 잠가 같은 신청의 동시 확정·재확정·반려를 줄 세운다
    -- (락 순서 rental_requests → games: reject_rental_request·cleanup_expired_dibs 와 같다)
    SELECT * INTO v_req FROM public.rental_requests WHERE id = p_request_id FOR UPDATE;
    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '요청을 찾을 수 없습니다.');
    END IF;
    -- 2026-10-11: 확정된 신청(auto_confirmed·manual_confirmed)도 게임·날짜 변경 재확정 허용
    IF v_req.status NOT IN ('pending', 'needs_review', 'auto_confirmed', 'manual_confirmed') THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 처리된 요청입니다.');
    END IF;
    -- 확정 건은 아직 열린 HOLD 가 있을 때만 (끝난 대여를 다시 살리지 않는다)
    IF v_req.status IN ('auto_confirmed', 'manual_confirmed') THEN
        SELECT COUNT(*) INTO v_open_holds
        FROM public.rentals r
        WHERE (r.rental_id = ANY(COALESCE(v_req.hold_rental_ids, '{}'))
               OR r.note = 'HOLD request:' || v_req.id::text)
          AND r.type = 'HOLD' AND r.returned_at IS NULL;
        IF v_open_holds = 0 THEN
            RETURN jsonb_build_object('success', false, 'message', '이미 종료된 대여입니다. 다시 확정할 수 없습니다.');
        END IF;
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
    WHERE id = p_request_id AND status = v_req.status;
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

REVOKE EXECUTE ON FUNCTION public.confirm_rental_request(uuid, integer[], timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_rental_request(uuid, integer[], timestamptz, integer) TO authenticated;
