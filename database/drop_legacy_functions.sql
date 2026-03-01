-- ============================================================
-- [정리] 레거시 및 위험 RPC 함수 제거
-- 작성일: 2026-03-01
-- 목적: 구버전 copy 기반 스키마 함수 및 버그 함수 제거
--       (check_rpc_functions.js 점검 결과 기반)
-- ============================================================
-- 실행 전 확인사항:
--   1. 프론트엔드 코드에서 아래 함수들이 호출되지 않음을 확인 (check_rpc_functions.js 실행)
--   2. Supabase SQL Editor에서 한 번에 전체 실행
--   3. 실행 후 check_rpc_functions.js 재실행하여 37 → 28개 확인
-- ============================================================


-- ============================================================
-- 1. 구버전 관리자 대여/반납 함수 (copy 기반 스키마 시절 레거시)
--    현재 admin_rent_game / admin_return_game 으로 대체됨
-- ============================================================

DROP FUNCTION IF EXISTS public.admin_rent_copy(INTEGER, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_rent_specific_copy(INTEGER, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_return_copy(INTEGER);
DROP FUNCTION IF EXISTS public.admin_return_specific_copy(INTEGER);


-- ============================================================
-- 2. 구버전 찜 만료 정리 함수
--    현재 cleanup_expired_dibs() 로 대체됨
-- ============================================================

DROP FUNCTION IF EXISTS public.cancel_expired_dibs();


-- ============================================================
-- 3. 마이그레이션 함수 (raw_games 테이블 없어서 이미 동작 안 함)
--    API 표면에서 제거
-- ============================================================

DROP FUNCTION IF EXISTS public.migrate_full_data();
DROP FUNCTION IF EXISTS public.migrate_games();


-- ============================================================
-- 4. 위험 함수: sync_available_count
--    WHERE 절 없는 UPDATE 버그 존재 → 실행 시 전 게임 재고 초기화 위험
-- ============================================================

DROP FUNCTION IF EXISTS public.sync_available_count();


-- ============================================================
-- 5. 미사용 함수: kiosk_pickup_all
--    프론트엔드 어디서도 호출하지 않음, 로컬 SQL에도 없음
-- ============================================================

DROP FUNCTION IF EXISTS public.kiosk_pickup_all(UUID[]);


-- ============================================================
-- 완료 확인
-- ============================================================

SELECT
    proname AS 함수명,
    pg_get_function_identity_arguments(oid) AS 파라미터
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prokind = 'f'
ORDER BY proname;
