-- [Migration] games 테이블에 설명서 및 영상 링크 컬럼 추가
-- 실행 방법: Supabase Dashboard -> SQL Editor -> 새 쿼리 생성 -> 붙여넣기 -> Run

-- 1. 영상 가이드 링크 (유튜브 등)
ALTER TABLE games ADD COLUMN IF NOT EXISTS video_url TEXT;

-- 2. 설명서 링크 (PDF, 노션 등)
ALTER TABLE games ADD COLUMN IF NOT EXISTS manual_url TEXT;

-- 확인용
SELECT * FROM games LIMIT 1;
