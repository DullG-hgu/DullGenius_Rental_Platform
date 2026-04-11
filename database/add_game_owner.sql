-- Add owner column to games table
ALTER TABLE games ADD COLUMN owner text;

-- Add comment for documentation
COMMENT ON COLUMN games.owner IS '보드게임 소유자 이름';
