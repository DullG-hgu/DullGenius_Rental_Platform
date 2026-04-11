-- ========================================
-- 대여 시스템 재설계: 데이터 마이그레이션
-- Copy 시스템 제거 → game_id 기반 단순화
-- ========================================

-- ⚠️ 주의: 단계별로 실행하고 각 단계 후 확인하세요!
-- 롤백이 필요하면 백업에서 복원하세요.

-- ========================================
-- STEP 0: 백업 확인
-- ========================================
-- Supabase Dashboard → Database → Backups 에서 최신 백업 확인
-- 또는 수동 백업:
-- pg_dump 명령어 사용 (로컬에서)

-- ========================================
-- STEP 1: games 테이블에 새 컬럼 추가
-- ========================================

-- 1-1. quantity 컬럼 추가 (보유 수량)
ALTER TABLE public.games 
ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;

-- 1-2. available_count 컬럼 추가 (대여 가능 수량)
ALTER TABLE public.games 
ADD COLUMN IF NOT EXISTS available_count INTEGER;

-- 확인
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'games' 
  AND column_name IN ('quantity', 'available_count');

-- 예상 결과:
-- quantity        | integer | 1
-- available_count | integer | NULL


-- ========================================
-- STEP 2: 기존 데이터로 quantity 계산
-- ========================================

-- 2-1. game_copies 개수로 quantity 설정
UPDATE public.games g
SET quantity = COALESCE((
    SELECT COUNT(*) 
    FROM public.game_copies gc 
    WHERE gc.game_id = g.id
), 1);

-- 확인
SELECT id, name, quantity 
FROM public.games 
WHERE quantity > 1 
ORDER BY quantity DESC 
LIMIT 10;

-- 예상: 대부분 1, 일부 게임만 2 이상


-- ========================================
-- STEP 3: available_count 계산
-- ========================================

-- 3-1. AVAILABLE 상태 copy 개수로 설정
UPDATE public.games g
SET available_count = COALESCE((
    SELECT COUNT(*) 
    FROM public.game_copies gc 
    WHERE gc.game_id = g.id 
      AND gc.status = 'AVAILABLE'
), 0);

-- 3-2. available_count가 음수가 되지 않도록 보정
UPDATE public.games 
SET available_count = 0 
WHERE available_count < 0;

-- 확인
SELECT 
    id, 
    name, 
    quantity, 
    available_count,
    (quantity - available_count) as rented_count
FROM public.games 
WHERE available_count < quantity
ORDER BY rented_count DESC
LIMIT 10;

-- 예상: 대여 중인 게임들이 표시됨


-- ========================================
-- STEP 4: rentals 테이블에 game_id 추가
-- ========================================

-- 4-1. 임시 컬럼 추가
ALTER TABLE public.rentals 
ADD COLUMN IF NOT EXISTS game_id_new INTEGER;

-- 4-2. game_copies를 통해 game_id 채우기
UPDATE public.rentals r
SET game_id_new = (
    SELECT gc.game_id 
    FROM public.game_copies gc 
    WHERE gc.copy_id = r.copy_id
);

-- 4-3. NULL 값 확인 (문제가 있는 데이터)
SELECT 
    r.rental_id,
    r.copy_id,
    r.game_name,
    r.type,
    r.returned_at
FROM public.rentals r
WHERE r.game_id_new IS NULL;

-- 만약 NULL이 있다면:
-- - copy_id가 잘못되었거나
-- - game_copies에 해당 copy가 없음
-- 수동으로 수정 필요!


-- ========================================
-- STEP 5: rentals 테이블 구조 변경
-- ========================================

-- 5-1. copy_id 컬럼 삭제 (백업 후!)
-- ⚠️ 주의: 이 단계는 되돌릴 수 없습니다!
ALTER TABLE public.rentals 
DROP COLUMN IF EXISTS copy_id;

-- 5-2. game_id_new → game_id로 이름 변경
ALTER TABLE public.rentals 
RENAME COLUMN game_id_new TO game_id;

-- 5-3. NOT NULL 제약 조건 추가
ALTER TABLE public.rentals 
ALTER COLUMN game_id SET NOT NULL;

-- 5-4. 외래 키 추가
ALTER TABLE public.rentals 
ADD CONSTRAINT rentals_game_id_fkey 
FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

-- 확인
SELECT 
    r.rental_id,
    r.game_id,
    g.name,
    r.type,
    r.returned_at
FROM public.rentals r
JOIN public.games g ON r.game_id = g.id
WHERE r.returned_at IS NULL
ORDER BY r.borrowed_at DESC
LIMIT 10;

-- 예상: 활성 rental들이 정상적으로 조인됨


-- ========================================
-- STEP 6: game_copies 테이블 제거
-- ========================================

-- 6-1. 참조하는 외래 키 확인
SELECT 
    tc.constraint_name,
    tc.table_name,
    kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND kcu.table_name = 'game_copies';

-- 6-2. game_copies 테이블 삭제
-- ⚠️ 주의: CASCADE로 관련 제약 조건도 모두 삭제됨!
DROP TABLE IF EXISTS public.game_copies CASCADE;

-- 확인
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name = 'game_copies';

-- 예상: 결과 없음 (테이블 삭제됨)


-- ========================================
-- STEP 7: 데이터 무결성 검증
-- ========================================

-- 7-1. 모든 게임의 quantity와 available_count 확인
SELECT 
    COUNT(*) as total_games,
    SUM(quantity) as total_copies,
    SUM(available_count) as total_available,
    SUM(quantity - available_count) as total_rented
FROM public.games;

-- 7-2. 활성 rental 개수와 대여 중 개수 비교
SELECT 
    (SELECT COUNT(*) FROM public.rentals WHERE returned_at IS NULL AND type = 'RENT') as active_rentals,
    (SELECT SUM(quantity - available_count) FROM public.games) as rented_count;

-- 예상: 두 값이 비슷해야 함 (완전히 같지 않을 수 있음)

-- 7-3. available_count가 음수인 게임 확인
SELECT id, name, quantity, available_count
FROM public.games
WHERE available_count < 0;

-- 예상: 결과 없음

-- 7-4. available_count가 quantity보다 큰 게임 확인
SELECT id, name, quantity, available_count
FROM public.games
WHERE available_count > quantity;

-- 예상: 결과 없음


-- ========================================
-- STEP 8: 완료 확인
-- ========================================

-- 8-1. 스키마 확인
\d public.games
\d public.rentals

-- 8-2. 샘플 데이터 확인
SELECT 
    g.id,
    g.name,
    g.quantity,
    g.available_count,
    COUNT(r.rental_id) FILTER (WHERE r.returned_at IS NULL) as active_rentals
FROM public.games g
LEFT JOIN public.rentals r ON g.id = r.game_id
GROUP BY g.id, g.name, g.quantity, g.available_count
HAVING COUNT(r.rental_id) FILTER (WHERE r.returned_at IS NULL) > 0
ORDER BY active_rentals DESC
LIMIT 10;

-- 예상: 대여 중인 게임들이 정상적으로 표시됨

-- ========================================
-- 마이그레이션 완료! ✅
-- ========================================
-- 다음 단계: RPC 함수 재작성 (Phase 3)
