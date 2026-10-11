-- 2026-10-11 키오스크 룰렛: BGG 추천 인원(suggested_numplayers) 저장
--
-- 값은 scripts/bgg_sync.mjs --only=numplayers 가 채운다 (근거: database/bgg_sync/2026-10-11_numplayers_report.md).
--   best_players        : BGG 투표상 「Best」 인원 목록 (예: {4,5})
--   recommended_players : Best 는 아니지만 추천 인원 목록 (Best 제외)
--   numplayers_votes    : 인원 투표 총수. NULL = BGG 데이터 없음 (bgg_id 없음 등)
-- 룰렛은 우리 min_players~max_players 범위를 먼저 지키고, 이 값으로 가중치만 준다.
-- 값이 NULL 이면 예전처럼 범위 안 균등 추첨.
--
-- 권한: games 는 anon/authenticated 에 테이블 단위 SELECT 라 새 컬럼도 그대로 읽힌다 (공개돼도 무방한 BGG 공개 정보).
-- get_games_with_rentals / get_game_with_rentals 는 to_jsonb(g.*) 라 RPC 변경 없이 내려간다.
-- GRANT·RLS·RPC 변경 없음.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS best_players int[];
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS recommended_players int[];
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS numplayers_votes int;

COMMENT ON COLUMN public.games.best_players IS 'BGG suggested_numplayers 투표상 Best 인원 (bgg_sync.mjs)';
COMMENT ON COLUMN public.games.recommended_players IS 'BGG 추천 인원 (Best 제외, bgg_sync.mjs)';
COMMENT ON COLUMN public.games.numplayers_votes IS 'BGG 인원 투표 총수. NULL = 데이터 없음';
