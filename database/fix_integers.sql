-- [Fix Integers] ID 컬럼을 BigInt(int8)로 변경하여 큰 숫자를 허용합니다.

-- 1. raw_games: 게임 ID
ALTER TABLE public.raw_games ALTER COLUMN id TYPE bigint;

-- 2. raw_reviews: 참조하는 게임 ID
ALTER TABLE public.raw_reviews ALTER COLUMN game_id TYPE bigint;

-- 3. raw_rentals: 참조하는 게임 ID
ALTER TABLE public.raw_rentals ALTER COLUMN game_id TYPE bigint;

-- 확인용 (선택사항)
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'raw_games' AND column_name = 'id';
