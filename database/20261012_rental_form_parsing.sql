-- 2026-10-12 단체 대여 폼 개편 대응 (GAS 재연결과 짝)
--
-- 1) _parse_duration: 범위 선택지(「2일 이상 4일 이내」)는 최댓값으로 잡는다.
--    예전엔 첫 숫자를 읽어 1일·2일 HOLD 로 자동 확정됐고, 그 뒤 회원 대여가 열렸다.
--    실제로 더 짧으면 관리자가 기간을 줄인다.
-- 2) ingest_rental_request 무료 판정: 폼에서 「일정계획」 질문이 빠져 항상 false 였다.
--    단체 성격 선택지 「… 학교 공식 행사단체 (비용 면제 가능)」로 판단한다.
--    대여료는 운영진이 직접 받으므로 관리자 화면 표시용이다.

CREATE OR REPLACE FUNCTION public._parse_duration(raw text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF raw IS NULL OR btrim(raw) = '' THEN RETURN NULL; END IF;
    -- 'N일' 이 여럿이면(범위) 가장 큰 값
    RETURN (SELECT max(m[1]::int) FROM regexp_matches(raw, '(\d+)\s*일', 'g') AS m);
END;
$function$;

-- ingest_rental_request 는 길어서 통째로 옮겨 적지 않고, 무료 판정 블록만 바꿔 다시 만든다.
-- 블록이 예상과 다르면(운영 정의가 바뀌었으면) 아무것도 바꾸지 않고 실패한다.
DO $do$
DECLARE
    v_def text;
    v_old text := $o$    v_is_free := (
        COALESCE(btrim(p_payload->>'org_name'), '') <> ''
        AND COALESCE(btrim(p_payload->>'event_overview'), '') <> ''
        AND COALESCE(btrim(p_payload->>'event_schedule'), '') <> ''
        AND COALESCE(btrim(p_payload->>'audience_notes'), '') <> ''
    );$o$;
    v_new text := $n$    -- 단체 성격 「학교 공식 행사단체 (비용 면제 가능)」 (2026-10-12, 일정계획 질문 삭제로 교체)
    v_is_free := COALESCE(p_payload->>'org_type', '') LIKE '%학교 공식%';$n$;
BEGIN
    v_def := pg_get_functiondef('public.ingest_rental_request(jsonb)'::regprocedure);
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'ingest_rental_request: 무료 판정 블록을 찾지 못함 — 운영 정의 확인 필요';
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
END
$do$;
