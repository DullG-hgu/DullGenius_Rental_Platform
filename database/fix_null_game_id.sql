-- ========================================
-- rentals 테이블에 game_id 직접 추가 (간소화)
-- ========================================

-- 1. game_id 컬럼이 없다면 추가
ALTER TABLE public.rentals 
ADD COLUMN IF NOT EXISTS game_id INTEGER;

-- 2. game_name을 기반으로 game_id 매핑
UPDATE public.rentals
SET game_id = (
    SELECT id FROM public.games WHERE name = rentals.game_name LIMIT 1
)
WHERE game_id IS NULL;

-- 3. 확인
SELECT 
    r.rental_id,
    r.game_id,
    r.game_name,
    g.name as actual_game_name,
    r.type,
    r.returned_at
FROM public.rentals r
LEFT JOIN public.games g ON r.game_id = g.id
WHERE r.returned_at IS NULL
ORDER BY r.borrowed_at DESC
LIMIT 20;

-- 예상: 모든 rental에 game_id가 채워져야 함
