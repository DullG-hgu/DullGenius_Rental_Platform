-- 'condition' 컬럼은 이미 존재하므로 'memo'만 추가합니다.

ALTER TABLE game_copies 
ADD COLUMN IF NOT EXISTS memo TEXT;

-- 기존 데이터 중 B, C등급이 아닌 건 A로 기본값 보정 (선택 사항)
UPDATE game_copies SET condition = 'A' WHERE condition IS NULL;
