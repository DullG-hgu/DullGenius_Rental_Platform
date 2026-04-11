-- reset_logs.sql
-- [WARNING] 이 스크립트는 모든 '대여/찜 기록'과 '로그'를 삭제하고,
-- 모든 게임 상태를 '대여 가능'으로 초기화합니다.
-- 시스템 오픈 전 초기화 용도로만 사용하세요.

BEGIN;

-- 1. 로그 삭제
TRUNCATE TABLE public.logs;

-- 2. 렌탈/찜 기록 삭제 (참조 무결성 위해 CASCADE 사용 가능하나, 여기선 그냥 삭제)
TRUNCATE TABLE public.rentals CASCADE; 
-- 만약 CASCADE가 부담스럽다면 DELETE FROM public.rentals;

-- 3. 모든 게임 카피 상태 초기화 (전부 반납된 상태로)
UPDATE public.game_copies
SET status = 'AVAILABLE';

COMMIT;

-- 결과 확인
SELECT 'All logs and rentals have been cleared, and copies reset to AVAILABLE.' as result;
