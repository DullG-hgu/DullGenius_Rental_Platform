-- ================================================================
-- 2026-09-03  회비 검사 토글이 실제로 동작하도록 수정
-- 적용: mcp apply_migration (fix_is_payment_check_enabled_reads_config)
-- ================================================================
--
-- 배경
--   database/payment_management.sql 이 app_config 를 읽는 is_payment_check_enabled() 를 만들었지만,
--   그 뒤 database/final_rpc_v2.sql 이 같은 이름을 `RETURN true` 스텁으로 덮어썼다.
--   운영 DB에는 스텁이 올라가 있어, 시스템 설정 탭의 "회비 검사 비활성화"가
--   app_config 값만 바꾸고 kiosk_rental / kiosk_pickup 의 회비 검사는 계속 켜져 있었다.
--   (증상: 관리자가 검사를 껐는데도 키오스크에서 "회비 납부가 필요합니다")
--
--   payment_management.sql 원본도 value 가 jsonb 인 걸 고려하지 않아
--   (TEXT 로 받으면 따옴표 포함 '"true"' 가 되어 'true' 와 불일치) 살렸어도 항상 false 였다.
--
-- 이 함수를 쓰는 곳: kiosk_pickup, kiosk_rental (2026-09-03 기준)

CREATE OR REPLACE FUNCTION public.is_payment_check_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (
      SELECT CASE jsonb_typeof(c.value)
               WHEN 'boolean' THEN (c.value)::boolean
               WHEN 'string'  THEN lower(c.value #>> '{}') = 'true'
               ELSE true
             END
      FROM public.app_config c
      WHERE c.key = 'payment_check_enabled'
    ),
    true
  );
$function$;

-- 지금까지는 함수가 항상 true 였으므로 실효 동작은 "검사 활성화" 였다.
-- 저장된 값은 2026-02-14 의 'false' 가 방치돼 있어, 함수만 고치면 오늘부터 갑자기
-- 미납 회원 대여가 열린다. 실효 동작을 그대로 유지하도록 값을 true 로 맞춘다.
-- (관리자가 시스템 설정 탭에서 끄면 그때부터 실제로 꺼진다)
-- [2026-09-03 저녁 되돌림] 이 UPDATE 는 잘못된 전제였다. 운영진은 시스템 탭에서 회비 검사를
--   의도적으로 꺼 둔 상태였고(저장값 'false'), 이 줄이 그 설정을 'true' 로 덮어써 당일 저녁
--   키오스크 찜 수령이 "회비 납부가 필요합니다" 로 막혔다. execute_sql 로 'false' 로 복구함.
--   교훈: 운영자가 UI 로 저장한 설정값은 마이그레이션에서 덮어쓰지 않는다.
UPDATE public.app_config
SET value = to_jsonb('true'::text), updated_at = timezone('utc'::text, now())
WHERE key = 'payment_check_enabled';
