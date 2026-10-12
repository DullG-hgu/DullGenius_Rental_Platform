-- 2026-10-12 단체 대여 폼 「원하는 보드게임」 매칭 보강
--
-- 예전: 쉼표로만 자르고 조각 그대로 비교 → 「판타지왕국」(DB: 판타지 왕국), 줄바꿈·띄어쓰기 구분이 전부 실패.
-- 지금:
--   1) 쉼표·줄바꿈·/ ; + & 「및」「그리고」 등으로 덩어리를 나누고, 덩어리를 띄어쓰기로 단어로 나눈다
--   2) 앞 단어부터 「가장 긴 단어 묶음」이 게임 이름과 같은지 본다 (띄어쓰기·구두점·대소문자 무시)
--      → 「판타지왕국」=「판타지 왕국」, 「뱅」=「뱅!」, 「카탄 루트」= 두 게임
--   3) 안 맞는 단어가 3글자 이상이면 그 단어를 품은 본판이 하나뿐일 때만 (「테라포밍」→ 테라포밍 마스)
--   매칭 못 한 단어는 버린다 → 개수가 안 맞아 관리자 검토로 간다 (틀리게 HOLD 잡는 것보다 안전)
-- 글자 단위로 훑지 않는 이유: 「쿠」「세트」「루트」 같은 1~2글자 이름이 다른 단어 속에서 잘못 잡힌다.

CREATE OR REPLACE FUNCTION public._normalize_game_name(s text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT regexp_replace(lower(COALESCE(s, '')), '[[:space:][:punct:]·、～‘’“”]', '', 'g');
$function$;

REVOKE EXECUTE ON FUNCTION public._normalize_game_name(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._fuzzy_match_games(raw text)
 RETURNS integer[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_names  jsonb;          -- 정규화 이름 → id (같은 이름이 둘이면 작은 id)
    v_chunk  text;
    v_words  text[];
    v_n      int;
    i        int;
    j        int;
    v_key    text;
    v_id     int;
    v_cnt    int;
    v_found  boolean;
    v_result int[] := '{}';
    c_max_words constant int := 12;   -- 가장 긴 게임 이름의 단어 수보다 넉넉히
    c_stopwords constant text[] := ARRAY[
        '보드게임','게임','확장','확장판','본판','기본판','추천','아무거나','정도','희망',
        '그리고','또는','혹은','등등','부탁드립니다','부탁드려요','원합니다','있으면','가능하면'
    ];
BEGIN
    IF raw IS NULL OR btrim(raw) = '' THEN
        RETURN '{}';
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

            -- (1) 가장 긴 단어 묶음부터 이름 정확 일치
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

            -- (2) 3글자 이상 단어: 그 단어를 품은 가장 짧은 이름
            IF NOT v_found THEN
                v_key := public._normalize_game_name(v_words[i]);
                IF char_length(v_key) >= 3
                   AND v_key <> ALL (c_stopwords)
                   AND v_key !~ '^[0-9]+(개|인|명|일|박|세트|set)?$' THEN
                    -- 본판 중 후보가 딱 하나일 때만 (「카르타벤추라」처럼 여럿이면 골라 주지 않고 검토로)
                    SELECT min(id), count(*) INTO v_id, v_cnt
                    FROM public.games
                    WHERE position(v_key IN public._normalize_game_name(name)) > 0
                      AND base_game_id IS NULL;
                    IF v_cnt = 1 THEN
                        v_result := array_append(v_result, v_id);
                    END IF;
                END IF;
                i := i + 1;
            END IF;
        END LOOP;
    END LOOP;

    RETURN v_result;
END;
$function$;
