-- enforce_review_constraints.sql

-- 1. 중복 리뷰 방지 (한 유저가 한 게임에 대해 하나의 리뷰만 작성 가능)
-- 기존 중복 데이터가 있다면 삭제하거나 정리해야 할 수 있음.
-- (여기서는 중복이 없다고 가정하거나, 실패 시 수동 정리 필요)
ALTER TABLE public.reviews
ADD CONSTRAINT unique_user_game_review UNIQUE (user_id, game_id);

-- 2. 평점 범위 제한 (1~5)
-- 프론트엔드에서 1~5만 보내지만, DB 제약조건으로 확실하게 방어.
ALTER TABLE public.reviews
ADD CONSTRAINT allowed_rating_range CHECK (rating >= 1 AND rating <= 5);
