
-- games 테이블에 추천 문구(recommendation_text)와 유튜브 영상 링크(video_url) 컬럼 추가
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS recommendation_text TEXT DEFAULT NULL;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS video_url TEXT DEFAULT NULL;

-- 코멘트 추가 for clarity
COMMENT ON COLUMN public.games.recommendation_text IS '게임 추천 문구 (관리자 작성)';
COMMENT ON COLUMN public.games.video_url IS '게임 설명 유튜브 영상 URL';
