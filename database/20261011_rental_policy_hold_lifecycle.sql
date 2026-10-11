-- 2026-10-11 단체대여(HOLD) 수명주기 — 자동 종료 폐지·관리자 반납/취소·외부 대여 통계 (G2 + G3=C)
-- 2026-10-12 운영 적용 (마이그레이션 20261011_rental_hold_lifecycle). %3 검증 반영: 수령 후 수령일 고정, reject 가 returned 덮지 않음, UUID 정규식
--
-- 사용자 결정(2026-10-11):
--   취소와 반려 구분(cancelled, 사유 선택) / 반납은 신청 단위 일괄(returned 신설, 부분 반납 없음)
--   키오스크는 단체 반납 안 받음 / 기한 지난 미반납은 기한 다음 날부터 관리자 화면 「단체 연체 N일」, 자동 통지 없음
--   노쇼 전용 처리 없음(연체로 잡히면 관리자가 취소) / 대여료 재산정 없음
--   수령 후 재확정은 기간·날짜만(게임 목록 변경 불가) / needs_review 5일 자동 반려 유지
--   회원 대여 통계는 그대로(type=RENT), 외부 대여 통계 RPC 별도
--
-- 이 파일:
--   [0] rental_requests.status CHECK 제약이 있으면 returned·cancelled 포함으로 교체
--   [1] cleanup_expired_dibs: 기한 지난 HOLD 자동 종료 제거 (DIBS 정리·needs_review 자동 반려는 그대로)
--   [2] fix_rental_data_consistency: 같은 HOLD 자동 종료 제거
--   [3] count_active_occupancy · recalc_all_game_availability: HOLD 점유에서 due_date > now() 제거
--   [4] confirm_rental_request · ingest_rental_request: 충돌 검사에서 HOLD due 조건 제거,
--       반납 전 연체 HOLD 의 범위 끝은 무기한 / confirm 에 수령 후 게임 변경 불가 검사
--   [5] cancel_rental_request · return_rental_request 신설
--   [6] get_external_rental_stats 신설
--   [7] _active_rentals_json: 관리자에게만 HOLD 행의 request_id 추가 (대여 현황 반납 버튼용)
--   전부 관리자 전용은 REVOKE FROM PUBLIC, anon. 락 순서 rental_requests → games. app_config 미변경.
--   confirm_rental_request 의 기준 본문은 운영 적용된 20261011_rental_policy_hold_reconfirm.sql.


-- [0] rental_requests.status 에 CHECK 제약이 있으면 returned·cancelled 를 포함하도록 교체
--     (원본 DDL 이 저장소에 없어 제약 유무를 모른다. 없으면 아무것도 하지 않는다)
DO $do$
DECLARE
    v_con     record;
    v_dropped int := 0;
BEGIN
    FOR v_con IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.rental_requests'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE public.rental_requests DROP CONSTRAINT %I', v_con.conname);
        v_dropped := v_dropped + 1;
    END LOOP;
    IF v_dropped > 0 THEN
        ALTER TABLE public.rental_requests ADD CONSTRAINT rental_requests_status_check
            CHECK (status IN ('pending', 'needs_review', 'auto_confirmed', 'manual_confirmed',
                              'rejected', 'cancelled', 'returned'));
    END IF;
END
$do$;

-- [1]
CREATE OR REPLACE FUNCTION public.cleanup_expired_dibs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_gid        INTEGER;
    v_hold_row   UUID;
    v_req_id     UUID;
    v_hold_ids   UUID[];
    v_dibs_count INTEGER := 0;
    v_hold_count INTEGER := 0;
    v_rejected   INTEGER := 0;
    v_recalced   INTEGER := 0;
    v_n          INTEGER;
BEGIN
    -- [1] 만료 DIBS 정리 — 게임 단위로 games 락 선획득 (락 순서: games→rentals)
    --     2026-10-11: HOLD(단체대여)는 더 이상 자동 종료하지 않는다. 관리자가 return_rental_request 로
    --     반납 처리할 때까지 점유하고, 기한 다음 날부터 관리자 화면에 「단체 연체」로 뜬다.
    --     expired_hold_count 는 호환을 위해 0 으로 계속 돌려준다.
    FOR v_gid IN
        SELECT DISTINCT game_id FROM public.rentals
        WHERE returned_at IS NULL AND type = 'DIBS' AND due_date < now()
        ORDER BY game_id
    LOOP
        PERFORM 1 FROM public.games WHERE id = v_gid FOR UPDATE;

        UPDATE public.rentals SET returned_at = now()
        WHERE game_id = v_gid AND type = 'DIBS' AND returned_at IS NULL AND due_date < now();
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_dibs_count := v_dibs_count + v_n;
    END LOOP;

    -- [2] needs_review 5일 경과 자동 반려 (2026-08-20 회장 확정 유예)
    --     조건부 UPDATE 선점: 그 사이 관리자가 confirm/reject 했으면 0행 → 건너뜀.
    --     RETURNING이 선점 시점의 hold_rental_ids를 주므로 옛 스냅샷 문제 없음.
    FOR v_req_id IN
        SELECT id FROM public.rental_requests
        WHERE status = 'needs_review'
          AND received_at < now() - interval '5 days'
        ORDER BY received_at
    LOOP
        UPDATE public.rental_requests
        SET status = 'rejected',
            review_note = COALESCE(review_note || ' | ', '') || '자동 반려: 검토 대기 5일 경과',
            reviewed_at = now()
        WHERE id = v_req_id AND status = 'needs_review'
        RETURNING hold_rental_ids INTO v_hold_ids;

        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        FOR v_hold_row, v_gid IN
            SELECT r.rental_id, r.game_id FROM public.rentals r
            WHERE r.rental_id = ANY(COALESCE(v_hold_ids, '{}'))
              AND r.returned_at IS NULL
            ORDER BY r.game_id
        LOOP
            PERFORM 1 FROM public.games WHERE id = v_gid FOR UPDATE;
            UPDATE public.rentals SET returned_at = now()
            WHERE rental_id = v_hold_row AND returned_at IS NULL;
        END LOOP;

        INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (NULL, NULL, 'RENTAL_REQUEST_AUTO_REJECT',
                jsonb_build_object('request_id', v_req_id, 'reason', 'needs_review 5일 경과'));

        v_rejected := v_rejected + 1;
    END LOOP;

    -- [3] 만료 정리분 + 7일 창 진입 HOLD + 타 경로 드리프트 일괄 보정 (needs_review 5일 자동 반려는 유지)
    v_recalced := public.recalc_all_game_availability();

    RETURN jsonb_build_object(
        'success', true,
        'cancelled_count', v_dibs_count,
        'expired_hold_count', v_hold_count,
        'auto_rejected_count', v_rejected,
        'availability_fixed', v_recalced
    );
END;
$function$;

-- [2]
CREATE OR REPLACE FUNCTION public.fix_rental_data_consistency()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_expired_dibs  INTEGER := 0;
    v_expired_holds INTEGER := 0;
    v_recalced      INTEGER := 0;
    v_dup_active    INTEGER := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '관리자 권한이 필요합니다.');
    END IF;

    WITH e AS (
        UPDATE public.rentals SET returned_at = now()
        WHERE type = 'DIBS' AND returned_at IS NULL AND due_date < now()
        RETURNING rental_id
    ) SELECT COUNT(*) INTO v_expired_dibs FROM e;

    -- 2026-10-11: 기한 지난 HOLD 자동 종료 제거 (관리자 반납 처리 전까지 점유). expired_holds_closed 는 0

    v_recalced := public.recalc_all_game_availability();

    -- 같은 사람이 같은 게임을 같은 타입으로 중복 점유한 건 — 보고만 한다
    SELECT COUNT(*) INTO v_dup_active FROM (
        SELECT game_id, user_id, type
        FROM public.rentals
        WHERE returned_at IS NULL AND user_id IS NOT NULL
        GROUP BY game_id, user_id, type
        HAVING COUNT(*) > 1
    ) d;

    RETURN jsonb_build_object(
        'success', true,
        'message', '데이터 정합성 정리 완료',
        'details', jsonb_build_object(
            'expired_dibs_closed', v_expired_dibs,
            'expired_holds_closed', v_expired_holds,
            'availability_recalculated', v_recalced,
            'duplicate_active_groups_found', v_dup_active
        )
    );
END;
$function$;

-- [3]
CREATE OR REPLACE FUNCTION public.count_active_occupancy(p_game_id integer)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::int
  FROM public.rentals r
  WHERE r.game_id = p_game_id
    AND r.returned_at IS NULL
    AND (
        r.type = 'RENT'
        OR (r.type = 'DIBS' AND r.due_date > now())
        -- HOLD: 수령 8일 전(borrowed_at = 수령 24시간 전, 선행 7일)부터 반납 처리 전까지. 기한이 지나도 점유
        OR (r.type = 'HOLD'
            AND r.borrowed_at <= now() + interval '7 days')
    );
$function$;

CREATE OR REPLACE FUNCTION public.recalc_all_game_availability()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_gid   INTEGER;
    v_fixed INTEGER;
BEGIN
    FOR v_gid IN SELECT id FROM public.games ORDER BY id LOOP
        PERFORM 1 FROM public.games WHERE id = v_gid FOR UPDATE;
    END LOOP;

    WITH want AS (
        SELECT g.id,
               GREATEST(0, COALESCE(g.quantity, 0) - COALESCE(o.cnt, 0)) AS value
        FROM public.games g
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS cnt
            FROM public.rentals r
            WHERE r.game_id = g.id
              AND r.returned_at IS NULL
              AND (
                  r.type = 'RENT'
                  OR (r.type = 'DIBS' AND r.due_date > now())
                  -- HOLD: count_active_occupancy 와 같은 식 (기한이 지나도 반납 처리 전까지 점유)
                  OR (r.type = 'HOLD'
                      AND r.borrowed_at <= now() + interval '7 days')
              )
        ) o ON true
    )
    UPDATE public.games g
    SET available_count = want.value
    FROM want
    WHERE g.id = want.id
      AND g.available_count IS DISTINCT FROM want.value;
    GET DIAGNOSTICS v_fixed = ROW_COUNT;

    RETURN v_fixed;
END;
$function$;

-- [4]
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
        -- 2026-10-11: 수령 후에는 게임 목록 변경 불가 (실물이 이미 나감). 기간·날짜 조정만 허용
        --   수령일도 고정한다: 수령일을 미래로 옮기면 다음 재확정에서 이 잠금이 풀리는 우회가 생긴다 (%3 검증)
        IF v_req.pickup_at IS NOT NULL AND now() >= v_req.pickup_at
           AND ((SELECT array_agg(x ORDER BY x) FROM unnest(p_game_ids) AS t(x))
                 IS DISTINCT FROM
                (SELECT array_agg(x ORDER BY x) FROM unnest(v_req.matched_game_ids) AS t(x))
                OR date_trunc('minute', p_pickup_at) IS DISTINCT FROM date_trunc('minute', v_req.pickup_at)) THEN  -- 화면 입력은 분 단위
            RETURN jsonb_build_object('success', false, 'message', '수령 후 게임·수령일 변경 불가 — 기간만 조정');
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
              OR type = 'HOLD'
          )
          -- 반납 처리 전 HOLD 는 기한이 지나도 언제 돌아올지 모르므로 끝을 무기한으로 본다
          -- (GREATEST(due_date, now()) 로는 다음 주 신청과 겹치지 않아 없는 게임에 HOLD 가 잡힌다)
          AND tstzrange(borrowed_at,
                        CASE WHEN type = 'HOLD' AND due_date <= now() THEN 'infinity'::timestamptz ELSE due_date END,
                        '[)')
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
                  OR type = 'HOLD'
              )
              -- 반납 처리 전 HOLD 는 기한이 지나도 끝을 무기한으로 본다 (confirm_rental_request 와 같은 식)
              AND tstzrange(borrowed_at,
                            CASE WHEN type = 'HOLD' AND due_date <= now() THEN 'infinity'::timestamptz ELSE due_date END,
                            '[)')
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

-- [5]
CREATE OR REPLACE FUNCTION public.cancel_rental_request(p_request_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- 단체대여 신청 취소 (반려와 구분). 수령 전 취소·노쇼·연체 후 미수령 정리에 쓴다.
-- 열린 HOLD 를 전부 닫고 재고를 즉시 돌린다. 신청자 통지 없음. 사유는 선택.
DECLARE
    v_req    public.rental_requests%ROWTYPE;
    v_note   text;
    v_row    uuid;
    v_gid    int;
    v_gids   int[] := '{}';
    v_closed int := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    -- 락 순서: rental_requests → games (confirm·reject·cleanup 과 같다)
    SELECT * INTO v_req FROM public.rental_requests WHERE id = p_request_id FOR UPDATE;
    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '요청을 찾을 수 없습니다.');
    END IF;
    IF v_req.status NOT IN ('pending', 'needs_review', 'auto_confirmed', 'manual_confirmed') THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 처리된 요청입니다.');
    END IF;

    v_note := 'HOLD request:' || v_req.id::text;
    FOR v_row, v_gid IN
        SELECT r.rental_id, r.game_id FROM public.rentals r
        WHERE (r.rental_id = ANY(COALESCE(v_req.hold_rental_ids, '{}')) OR r.note = v_note)
          AND r.type = 'HOLD' AND r.returned_at IS NULL
        ORDER BY r.game_id, r.rental_id
    LOOP
        PERFORM 1 FROM public.games WHERE id = v_gid FOR UPDATE;
        UPDATE public.rentals SET returned_at = now()
        WHERE rental_id = v_row AND returned_at IS NULL;
        v_closed := v_closed + 1;
        v_gids := array_append(v_gids, v_gid);
    END LOOP;

    UPDATE public.rental_requests
    SET status = 'cancelled',
        review_note = COALESCE(review_note || ' | ', '') || '취소'
                      || COALESCE(': ' || NULLIF(btrim(p_reason), ''), ''),
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id;

    FOR v_gid IN SELECT DISTINCT g FROM unnest(v_gids) AS t(g) ORDER BY g LOOP
        PERFORM public.recalc_game_availability(v_gid);
    END LOOP;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (NULL, auth.uid(), 'RENTAL_REQUEST_CANCEL',
            jsonb_build_object('request_id', p_request_id, 'prior_status', v_req.status,
                               'reason', NULLIF(btrim(p_reason), ''), 'closed_holds', v_closed));

    RETURN jsonb_build_object('success', true, 'closed_holds', v_closed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.return_rental_request(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- 단체대여 반납 처리 — 신청 단위로 한 번에 (부분 반납 없음). 관리자만, 키오스크는 받지 않는다.
-- 열린 HOLD 를 전부 닫고 재고를 즉시 돌린다. 상태 returned.
DECLARE
    v_req      public.rental_requests%ROWTYPE;
    v_note     text;
    v_row      uuid;
    v_gid      int;
    v_gids     int[] := '{}';
    v_closed   int := 0;
    v_first    timestamptz;
    v_due      timestamptz;
    v_overdue  int;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    -- 락 순서: rental_requests → games
    SELECT * INTO v_req FROM public.rental_requests WHERE id = p_request_id FOR UPDATE;
    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '요청을 찾을 수 없습니다.');
    END IF;
    IF v_req.status NOT IN ('auto_confirmed', 'manual_confirmed') THEN
        RETURN jsonb_build_object('success', false, 'message', '확정된 대여만 반납 처리 가능');
    END IF;

    v_note := 'HOLD request:' || v_req.id::text;
    SELECT MIN(r.borrowed_at), MAX(r.due_date) INTO v_first, v_due
    FROM public.rentals r
    WHERE (r.rental_id = ANY(COALESCE(v_req.hold_rental_ids, '{}')) OR r.note = v_note)
      AND r.type = 'HOLD' AND r.returned_at IS NULL;
    IF v_first IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '열린 대여 없음');
    END IF;
    -- borrowed_at = 수령 24시간 전. 그 전이면 아직 아무것도 안 나간 것 → 취소로 처리
    IF now() < v_first THEN
        RETURN jsonb_build_object('success', false, 'message', '수령 전 — 취소로 처리');
    END IF;

    FOR v_row, v_gid IN
        SELECT r.rental_id, r.game_id FROM public.rentals r
        WHERE (r.rental_id = ANY(COALESCE(v_req.hold_rental_ids, '{}')) OR r.note = v_note)
          AND r.type = 'HOLD' AND r.returned_at IS NULL
        ORDER BY r.game_id, r.rental_id
    LOOP
        PERFORM 1 FROM public.games WHERE id = v_gid FOR UPDATE;
        UPDATE public.rentals SET returned_at = now()
        WHERE rental_id = v_row AND returned_at IS NULL;
        v_closed := v_closed + 1;
        v_gids := array_append(v_gids, v_gid);
    END LOOP;

    UPDATE public.rental_requests
    SET status = 'returned',
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id;

    FOR v_gid IN SELECT DISTINCT g FROM unnest(v_gids) AS t(g) ORDER BY g LOOP
        PERFORM public.recalc_game_availability(v_gid);
    END LOOP;

    -- 단체 연체 일수: 기한 다음 날(KST)부터 1일 (프런트 holdOverdueDays 와 같은 식)
    v_overdue := GREATEST(0,
        (now() AT TIME ZONE 'Asia/Seoul')::date
        - ((v_due - interval '1 millisecond') AT TIME ZONE 'Asia/Seoul')::date);

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (NULL, auth.uid(), 'RENTAL_REQUEST_RETURN',
            jsonb_build_object('request_id', p_request_id, 'closed_holds', v_closed,
                               'due_date', v_due, 'overdue_days', v_overdue));

    RETURN jsonb_build_object('success', true, 'closed_holds', v_closed, 'overdue_days', v_overdue);
END;
$function$;

-- [6]
CREATE OR REPLACE FUNCTION public.get_external_rental_stats(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- 외부(단체) 대여 통계 — 관리자 전용 읽기. 회원 대여 통계(type=RENT)와 섞지 않는다.
-- 기간은 KST 날짜, 양끝 포함.
--   신청 건수(requests·by_status): 접수일(received_at) 기준, 현재 상태별
--   대여 지표(rentals 이하): 수령일(pickup_at) 기준, 현재 확정·반납 완료 건
--     (재확정은 옛 HOLD 를 닫고 새로 만들므로 게임 수는 HOLD 행이 아니라 최종 matched_game_ids 로 센다)
--   연체: 반납 시각(미반납이면 지금)이 기한 다음 날(KST) 이후
DECLARE
    v_from timestamptz := (p_start_date::timestamp) AT TIME ZONE 'Asia/Seoul';
    v_to   timestamptz := ((p_end_date + 1)::timestamp) AT TIME ZONE 'Asia/Seoul';
    v_result jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION '기간이 올바르지 않습니다.';
    END IF;

    WITH req AS (
        SELECT * FROM public.rental_requests
        WHERE received_at >= v_from AND received_at < v_to
    ),
    rent AS (
        SELECT q.*,
               q.pickup_at + make_interval(days => q.duration_days) AS due_at,
               (SELECT MAX(r.returned_at) FROM public.rentals r
                 WHERE r.rental_id = ANY(q.hold_rental_ids)) AS returned_at,
               EXISTS (SELECT 1 FROM public.rentals r
                        WHERE r.rental_id = ANY(q.hold_rental_ids) AND r.returned_at IS NULL) AS is_open
        FROM public.rental_requests q
        WHERE q.status IN ('auto_confirmed', 'manual_confirmed', 'returned')
          AND q.pickup_at >= v_from AND q.pickup_at < v_to
          AND q.duration_days IS NOT NULL
    ),
    rent_x AS (
        SELECT rent.*,
               ((CASE WHEN is_open THEN now() ELSE returned_at END) AT TIME ZONE 'Asia/Seoul')::date
                 > ((due_at - interval '1 millisecond') AT TIME ZONE 'Asia/Seoul')::date AS overdue
        FROM rent
    ),
    top AS (
        SELECT g.id, g.name, COUNT(*)::int AS copies, COUNT(DISTINCT x.id)::int AS requests
        FROM rent_x x
        CROSS JOIN LATERAL unnest(x.matched_game_ids) AS m(gid)
        JOIN public.games g ON g.id = m.gid
        GROUP BY g.id, g.name
        ORDER BY copies DESC, requests DESC, g.name
        LIMIT 10
    )
    SELECT jsonb_build_object(
        'period', jsonb_build_object('start', p_start_date, 'end', p_end_date),
        'requests', (SELECT COUNT(*) FROM req),
        'by_status', COALESCE((SELECT jsonb_object_agg(status, n)
                               FROM (SELECT status, COUNT(*)::int AS n FROM req GROUP BY status) s), '{}'::jsonb),
        'rentals', (SELECT COUNT(*) FROM rent_x),
        'rentals_open', (SELECT COUNT(*) FROM rent_x WHERE is_open),
        'rentals_returned', (SELECT COUNT(*) FROM rent_x WHERE status = 'returned'),
        'game_copies', COALESCE((SELECT SUM(cardinality(matched_game_ids)) FROM rent_x), 0),
        'avg_duration_days', (SELECT ROUND(AVG(duration_days)::numeric, 1) FROM rent_x),
        'overdue', (SELECT COUNT(*) FROM rent_x WHERE overdue),
        'overdue_open', (SELECT COUNT(*) FROM rent_x WHERE overdue AND is_open),
        'top_games', COALESCE((SELECT jsonb_agg(jsonb_build_object('game_id', id, 'name', name,
                                                                  'copies', copies, 'requests', requests)
                                                ORDER BY copies DESC, requests DESC, name)
                               FROM top), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;


-- [7] _active_rentals_json: 관리자에게만 HOLD 행의 request_id (비관리자 응답은 그대로 — 키 값 null)
CREATE OR REPLACE FUNCTION public._active_rentals_json(p_game_id integer, p_uid uuid, p_admin boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'rental_id',   r.rental_id,
          'game_id',     r.game_id,
          'user_id',     CASE WHEN p_admin OR r.user_id = p_uid THEN r.user_id END,
          'renter_name', CASE WHEN p_admin OR r.user_id = p_uid THEN r.renter_name END,
          'type',        r.type,
          'returned_at', r.returned_at,
          'due_date',    r.due_date,
          'borrowed_at', r.borrowed_at,
          -- 2026-10-11: 단체대여(HOLD) 행의 신청 id — 관리자에게만 (대여 현황에서 신청 단위 반납 처리용)
          'request_id',  CASE WHEN p_admin AND r.type = 'HOLD'
                                   AND r.note ~ '^HOLD request:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                              THEN substr(r.note, 14)::uuid END,
          'profiles',    CASE WHEN (p_admin OR r.user_id = p_uid) AND p.id IS NOT NULL
                              THEN jsonb_build_object('name', p.name) END
        )
        ORDER BY r.borrowed_at
      )
      FROM public.rentals r
      LEFT JOIN public.profiles p
        ON (p_admin OR r.user_id = p_uid) AND p.id = r.user_id
      WHERE r.game_id = p_game_id
        AND r.returned_at IS NULL
    ),
    '[]'::jsonb
  );
$function$;

-- 권한 — 관리자 RPC: authenticated 만 (is_admin() 게이트), anon·PUBLIC 회수
-- [8] reject_rental_request: 반납 완료(returned) 건을 반려로 덮지 않는다 (%3 검증). 그 외 본문은 _LIVE 그대로
CREATE OR REPLACE FUNCTION public.reject_rental_request(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_hold_ids uuid[];
    v_hold_row uuid;
    v_gid      int;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    UPDATE public.rental_requests
    SET status = 'rejected',
        review_note = p_reason,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id AND status NOT IN ('rejected', 'cancelled', 'returned')
    RETURNING hold_rental_ids INTO v_hold_ids;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '요청이 없거나 이미 처리되었습니다.');
    END IF;

    FOR v_hold_row, v_gid IN
        SELECT r.rental_id, r.game_id FROM public.rentals r
        WHERE r.rental_id = ANY(COALESCE(v_hold_ids, '{}'))
          AND r.returned_at IS NULL
        ORDER BY r.game_id
    LOOP
        PERFORM 1 FROM public.games WHERE id = v_gid FOR UPDATE;
        UPDATE public.rentals SET returned_at = now()
        WHERE rental_id = v_hold_row AND returned_at IS NULL;
        PERFORM public.recalc_game_availability(v_gid);
    END LOOP;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (
        NULL, auth.uid(), 'RENTAL_REQUEST_REJECT',
        jsonb_build_object('request_id', p_request_id, 'reason', p_reason)
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirm_rental_request(uuid, integer[], timestamptz, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirm_rental_request(uuid, integer[], timestamptz, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_rental_request(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_rental_request(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.return_rental_request(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.return_rental_request(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_external_rental_stats(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_external_rental_stats(date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_rental_request(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reject_rental_request(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fix_rental_data_consistency() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fix_rental_data_consistency() TO authenticated;
-- 크론·내부 전용 (현행 anon -, auth - 유지)
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_dibs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_all_game_availability() FROM PUBLIC, anon, authenticated;
-- count_active_occupancy(INVOKER, 현행 anon Y·auth Y)·ingest_rental_request(GAS 가 anon 키로 호출, 현행 anon Y)는
-- CREATE OR REPLACE 가 기존 권한을 유지하므로 손대지 않는다.
