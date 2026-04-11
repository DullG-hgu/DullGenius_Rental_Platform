-- 1:N 구조에서 개별 카피(재고) 관리를 위한 컬럼 추가
-- (A급, B급 등의 상태 및 비고란)

ALTER TABLE game_copies 
ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'A' CHECK (condition IN ('A', 'B', 'C', 'Faulty')),
ADD COLUMN IF NOT EXISTS memo TEXT;

-- 기존 데이터 초기화 (null 방지)
UPDATE game_copies SET condition = 'A' WHERE condition IS NULL;
