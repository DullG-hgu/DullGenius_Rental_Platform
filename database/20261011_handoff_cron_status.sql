-- 2026-10-11 자동화 상태 패널 (관리자 > 시스템 탭, 읽기 전용)
-- 2026-10-11 운영 적용 (마이그레이션 20261011_admin_cron_status)
--
-- 왜: 찜 정리 자동화가 3개월간 초록불인 채로 아무것도 안 한 적이 있다(GH Actions 조용한 실패).
--     코드 모르는 후임자가 「DB 안 자동 작업이 돌고 있나」를 SQL 없이 보게 한다.
-- 무엇: pg_cron 잡 목록 + 잡별 마지막 실행·마지막 실패 + 최근 실행 N건.
-- 범위 밖: GitHub Actions·Netlify 예약 함수(keepalive 핑 등)는 DB에 기록이 없어 여기서 안 보인다 — 화면에도 명시.
--
-- 부하(운영 Nano): cron.job_run_details 는 pg_cron 이 기본으로 지우지 않아 계속 쌓인다.
--   max(runid)(기본키 끝 1건)로 하한을 잡고, 모든 조회를 최근 c_window(2000)회 runid 범위 안에서만 한다.
--   잡별 마지막 실행·실패는 잡마다 따로(LATERAL) 찾는다 — 자주 도는 잡이 드문 잡의 기록을 밀어내지 않게.
--   범위 안에 기록이 없는 잡은 last_start 가 null → 화면에 「최근 기록 없음」.
--   ⚠️ 적용 후 EXPLAIN 으로 runid 기본키 인덱스 범위 스캔인지 확인 권장(로컬에서 실행계획 미확인).
--   command 칸은 내려주지 않는다(호출 URL·키가 들어 있을 수 있다). 오류 메시지는 _admin_cron_mask 로 가린다.
--
-- 되돌리기: DROP FUNCTION public.admin_cron_status(integer); DROP FUNCTION public._admin_cron_mask(text);

-- 오류 메시지 가림: 300자로 자르고, 토큰처럼 보이는 긴 문자열(24자 이상 영숫자·기호)은 [가림]
-- (command 칸은 아예 안 내려주지만, 실패 메시지에 호출 URL·키가 섞여 나올 수 있다)
CREATE OR REPLACE FUNCTION public._admin_cron_mask(p_message text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_temp'
AS $function$
  SELECT CASE WHEN p_message IS NULL THEN NULL
              ELSE left(regexp_replace(p_message, '[A-Za-z0-9_\-\.=+/]{24,}', '[가림]', 'g'), 300) END
$function$;
REVOKE EXECUTE ON FUNCTION public._admin_cron_mask(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_cron_status(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_window constant integer := 2000;  -- 잡별 마지막 실행·실패를 찾을 최근 실행 기록 범위(runid)
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_floor  bigint;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;

  IF to_regclass('cron.job') IS NULL OR to_regclass('cron.job_run_details') IS NULL THEN
    RETURN jsonb_build_object('available', false, 'jobs', '[]'::jsonb, 'recent', '[]'::jsonb, 'window', c_window);
  END IF;

  -- 기본키(runid) 역순 1건 → 하한. 아래 조회는 전부 runid > v_floor 범위 안에서만 (전체 스캔 없음)
  SELECT coalesce(max(d.runid), 0) - c_window INTO v_floor FROM cron.job_run_details d;

  RETURN jsonb_build_object(
    'available', true,
    'window', c_window,
    'now', now(),
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'jobid', j.jobid, 'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_status', lr.status, 'last_start', lr.start_time, 'last_end', lr.end_time,
        'last_message', CASE WHEN lr.status = 'failed' THEN public._admin_cron_mask(lr.return_message) END,
        'last_fail_at', lf.start_time, 'last_fail_message', public._admin_cron_mask(lf.return_message)
      ) ORDER BY j.jobname NULLS LAST, j.jobid)
      FROM cron.job j
      -- 잡마다 따로 찾는다: 자주 도는 잡이 드문 잡의 기록을 창 밖으로 밀어내지 않게
      LEFT JOIN LATERAL (
        SELECT d.status, d.start_time, d.end_time, d.return_message
        FROM cron.job_run_details d
        WHERE d.jobid = j.jobid AND d.runid > v_floor
        ORDER BY d.runid DESC LIMIT 1
      ) lr ON true
      LEFT JOIN LATERAL (
        SELECT d.start_time, d.return_message
        FROM cron.job_run_details d
        WHERE d.jobid = j.jobid AND d.runid > v_floor AND d.status = 'failed'
        ORDER BY d.runid DESC LIMIT 1
      ) lf ON true
    ), '[]'::jsonb),
    'recent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'runid', x.runid, 'name', j.jobname, 'status', x.status,
        'start', x.start_time, 'end', x.end_time,
        'message', CASE WHEN x.status = 'failed' THEN public._admin_cron_mask(x.return_message) END
      ) ORDER BY x.runid DESC)
      FROM (
        SELECT d.runid, d.jobid, d.status, d.start_time, d.end_time, d.return_message
        FROM cron.job_run_details d
        WHERE d.runid > v_floor
        ORDER BY d.runid DESC LIMIT v_limit
      ) x
      LEFT JOIN cron.job j ON j.jobid = x.jobid
    ), '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_cron_status(integer) IS
  '관리자 시스템 탭 자동화 상태. pg_cron 잡별 마지막 실행·실패(최근 2000회 runid 범위, 잡별) + 최근 실행 N건(최대 50). 읽기 전용.';

-- 관리자 전용 SECURITY DEFINER: CREATE FUNCTION 기본값이 PUBLIC EXECUTE 라 PUBLIC·anon 모두 회수해야 한다
REVOKE EXECUTE ON FUNCTION public.admin_cron_status(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cron_status(integer) TO authenticated;
-- 적용 후 확인: _LIVE/grants.sql 에서 admin_cron_status 의 anon 열이 '-' 인지
