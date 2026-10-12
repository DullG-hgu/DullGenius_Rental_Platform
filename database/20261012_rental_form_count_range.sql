-- 2026-10-12 단체 대여 폼 자동 확정 판정: 개수 범위 + 못 찾은 게임
--
-- 문제: 「1~2개 (4000원)」를 2개로 읽고 매칭 수와 「정확히 같아야」 확정 → 1개만 빌리는 신청이 전부 검토행,
--       검토 대기는 5일 뒤 자동 반려. 그렇다고 범위만 넓히면 「카탄, 스플랜더(오타)」가 카탄만 확정된다.
-- 해법:
--   - 매칭이 「못 찾은 단어」도 돌려준다 (_match_requested_games). 하나라도 있으면 검토.
--   - 개수 선택지가 「N~M개」면 매칭 수가 N..M 안이면 확정. 「직접 협의」(숫자 없음)는 항상 검토.
--   - 검토로 보낼 때 사유를 review_note 에 남긴다 (관리자 화면 「메모」).

-- 1) 매칭 본체: ids + unmatched
CREATE OR REPLACE FUNCTION public._match_requested_games(raw text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_names     jsonb;          -- 정규화 이름 → id (같은 이름이 둘이면 작은 id)
    v_chunk     text;
    v_words     text[];
    v_n         int;
    i           int;
    j           int;
    v_key       text;
    v_id        int;
    v_cnt       int;
    v_found     boolean;
    v_result    int[]  := '{}';
    v_unmatched text[] := '{}';
    c_max_words constant int := 12;   -- 가장 긴 게임 이름의 단어 수보다 넉넉히
    -- 게임 이름이 아닌 군말. 못 찾은 단어로 치지 않는다
    c_stopwords constant text[] := ARRAY[
        '보드게임','게임','확장','확장판','본판','기본판','추천','아무거나','정도','희망',
        '그리고','또는','혹은','등등','부탁드립니다','부탁드려요','원합니다','있으면','가능하면',
        '등','및','외','중','하고','랑','이랑','와','과','개','세트','set'
    ];
BEGIN
    IF raw IS NULL OR btrim(raw) = '' THEN
        RETURN jsonb_build_object('ids', '[]'::jsonb, 'unmatched', '[]'::jsonb);
    END IF;

    SELECT jsonb_object_agg(n, id) INTO v_names
    FROM (
        SELECT DISTINCT ON (n) public._normalize_game_name(name) AS n, id
        FROM public.games
        ORDER BY n, id
    ) t
    WHERE n <> '';

    FOREACH v_chunk IN ARRAY regexp_split_to_array(raw, '[,，\n\r/;、+&]|\s(및|그리고|하고|또는|혹은)\s') LOOP
        v_words := array_remove(regexp_split_to_array(btrim(v_chunk), '\s+'), '');
        v_n := COALESCE(array_length(v_words, 1), 0);
        i := 1;

        WHILE i <= v_n LOOP
            v_found := false;

            -- (1) 가장 긴 단어 묶음부터 이름 정확 일치 (띄어쓰기·구두점·대소문자 무시)
            FOR j IN REVERSE LEAST(v_n, i + c_max_words - 1) .. i LOOP
                v_key := public._normalize_game_name(array_to_string(v_words[i:j], ''));
                CONTINUE WHEN v_key = '';
                v_id := (v_names ->> v_key)::int;
                IF v_id IS NOT NULL THEN
                    v_result := array_append(v_result, v_id);
                    i := j + 1;
                    v_found := true;
                    EXIT;
                END IF;
            END LOOP;

            IF NOT v_found THEN
                v_key := public._normalize_game_name(v_words[i]);
                -- 군말·수량(「2개」「4인」)·빈 칸은 건너뛴다
                IF v_key = '' OR v_key = ANY (c_stopwords)
                   OR v_key ~ '^[0-9~]+(개|인|명|일|박|세트|set)?$' THEN
                    NULL;
                -- (2) 3글자 이상: 그 단어를 품은 본판이 딱 하나일 때만 (「카르타벤추라」처럼 여럿이면 못 찾음)
                ELSIF char_length(v_key) >= 3 THEN
                    SELECT min(id), count(*) INTO v_id, v_cnt
                    FROM public.games
                    WHERE position(v_key IN public._normalize_game_name(name)) > 0
                      AND base_game_id IS NULL;
                    IF v_cnt = 1 THEN
                        v_result := array_append(v_result, v_id);
                    ELSE
                        v_unmatched := array_append(v_unmatched, v_words[i]);
                    END IF;
                ELSE
                    v_unmatched := array_append(v_unmatched, v_words[i]);
                END IF;
                i := i + 1;
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object('ids', to_jsonb(v_result), 'unmatched', to_jsonb(v_unmatched));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._match_requested_games(text) FROM PUBLIC, anon, authenticated;

-- 2) 기존 이름은 ids 만 돌려주는 얇은 껍데기로 유지
CREATE OR REPLACE FUNCTION public._fuzzy_match_games(raw text)
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(array_agg(x::int), '{}')
    FROM jsonb_array_elements_text(public._match_requested_games(raw) -> 'ids') AS x;
$function$;

-- 3) ingest_rental_request: 블록 단위로 바꿔 다시 만든다 (통째로 옮겨 적지 않음).
--    각 블록이 운영 정의에 정확히 한 번 있어야 하고, 아니면 아무것도 바꾸지 않고 실패한다.
DO $do$
DECLARE
    v_def  text;
    v_pair text[];
    v_pairs text[][] := ARRAY[
        -- (a) 변수
        ARRAY[$o$    v_game_name       text;$o$,
              $n$    v_game_name       text;
    v_match           jsonb;
    v_unmatched       text[];
    v_count_min       int;
    v_count_match     int;
    v_reasons         text[] := '{}';$n$],
        -- (b) 매칭: 못 찾은 단어까지
        ARRAY[$o$    v_matched_ids   := public._fuzzy_match_games(v_games_raw);$o$,
              $n$    v_match         := public._match_requested_games(v_games_raw);
    SELECT COALESCE(array_agg(x::int), '{}') INTO v_matched_ids
      FROM jsonb_array_elements_text(v_match -> 'ids') AS x;
    SELECT COALESCE(array_agg(x), '{}') INTO v_unmatched
      FROM jsonb_array_elements_text(v_match -> 'unmatched') AS x;
    v_count_match   := COALESCE(array_length(v_matched_ids, 1), 0);$n$],
        -- (c) 개수: 「N~M개」면 하한 N, 「직접 협의」면 매칭 수를 표시용으로
        ARRAY[$o$    IF v_game_count IS NULL THEN
        SELECT COUNT(*) INTO v_game_count
        FROM unnest(string_to_array(v_games_raw, ',')) t
        WHERE btrim(t) <> '';
    END IF;$o$,
              $n$    v_count_min := COALESCE(
        (regexp_match(v_game_count_raw, '(\d+)\s*~\s*\d+\s*개'))[1]::int,
        v_game_count
    );

    IF v_game_count IS NULL THEN
        -- 「직접 협의」: 표시용으로 매칭 수를 넣고, 자동 확정은 하지 않는다
        v_game_count := v_count_match;
    END IF;$n$],
        -- (d) 자동 확정 판정
        ARRAY[$o$    v_auto_ok := (
        v_matched_ids IS NOT NULL
        AND array_length(v_matched_ids, 1) = v_game_count
        AND v_game_count > 0
        AND v_pickup_at IS NOT NULL
        AND v_duration_days IS NOT NULL
        AND v_pickup_at > now()
    );$o$,
              $n$    -- 2026-10-12: 개수 범위(「1~2개」면 1~2개) + 못 찾은 게임 없음
    IF cardinality(v_unmatched) > 0 THEN
        v_reasons := v_reasons || ('못 찾은 게임: ' || array_to_string(v_unmatched, ', '));
    END IF;
    IF v_count_match = 0 THEN
        v_reasons := v_reasons || '확인된 게임 없음'::text;
    ELSIF v_count_min IS NULL THEN
        v_reasons := v_reasons || '개수 직접 협의'::text;
    ELSIF v_count_match < v_count_min OR v_count_match > v_game_count THEN
        v_reasons := v_reasons || format('게임 %s개 확인 / 선택 「%s」', v_count_match, v_game_count_raw);
    END IF;
    IF v_pickup_at IS NULL THEN
        v_reasons := v_reasons || '수령 일정 해석 불가'::text;
    ELSIF v_pickup_at <= now() THEN
        v_reasons := v_reasons || '수령 일정이 이미 지남'::text;
    END IF;
    IF v_duration_days IS NULL THEN
        v_reasons := v_reasons || '대여 기간 직접 협의'::text;
    END IF;

    v_auto_ok := cardinality(v_reasons) = 0;$n$],
        -- (e) 검토로 보낼 때 사유 기록
        ARRAY[$o$        v_status := 'needs_review';
        UPDATE public.rental_requests
        SET status = v_status
        WHERE id = v_request_id;$o$,
              $n$        v_status := 'needs_review';
        UPDATE public.rental_requests
        SET status = v_status,
            review_note = '자동 확정 안 됨 — ' || array_to_string(v_reasons, ' / ')
        WHERE id = v_request_id;$n$]
    ];
BEGIN
    v_def := pg_get_functiondef('public.ingest_rental_request(jsonb)'::regprocedure);
    FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
        IF (length(v_def) - length(replace(v_def, v_pair[1], ''))) / length(v_pair[1]) <> 1 THEN
            RAISE EXCEPTION 'ingest_rental_request: 블록이 정확히 한 번 있지 않음 — %', left(v_pair[1], 60);
        END IF;
        v_def := replace(v_def, v_pair[1], v_pair[2]);
    END LOOP;
    EXECUTE v_def;
END
$do$;
