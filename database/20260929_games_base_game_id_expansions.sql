-- 2026-09-29 확장판 식별: games.base_game_id (NULL = 본판/단독 게임)
-- 1) 기존 확장판 12개에 본판 연결  2) 이상형 월드컵 후보·랭킹에서 확장판 제외
-- 과거 판의 확장판 대결 기록(fun_worldcup_matches)은 지우지 않는다. 진행 중인 판의 대진도 그대로 둔다.
-- 되돌리기: 아래 두 함수를 base_game_id 조건 없이 재정의 후 ALTER TABLE games DROP COLUMN base_game_id;

-- ── 마이그레이션 1: games_base_game_id_expansions ──
ALTER TABLE public.games
  ADD COLUMN base_game_id int4 NULL
    REFERENCES public.games(id) ON DELETE RESTRICT,
  ADD CONSTRAINT games_base_game_not_self CHECK (base_game_id IS DISTINCT FROM id);

COMMENT ON COLUMN public.games.base_game_id IS '확장판이면 본판 games.id. NULL = 본판/단독 게임. 월드컵 후보·랭킹에서 제외된다.';

CREATE INDEX games_base_game_id_idx ON public.games(base_game_id) WHERE base_game_id IS NOT NULL;

-- 루트 리버포크→루트, 뱅 모음→뱅!, 위쳐 킥스타터→위쳐 올드 월드, 정령섬 가지와 발톱→정령섬,
-- 카탄 항해사·도시와 기사→카탄, 테라포밍 확장 3종→테라포밍 마스, 타임 스토리즈 시나리오 3종→타임 스토리즈
UPDATE public.games g SET base_game_id = v.base
FROM (VALUES
  (45, 44), (61, 60), (114, 113), (125, 124),
  (142, 141), (259, 141),
  (222, 162), (223, 162), (224, 162),
  (156, 155), (157, 155), (158, 155)
) AS v(id, base)
WHERE g.id = v.id;

-- ── 마이그레이션 2: fun_wc_exclude_expansions ──
-- _fun_wc_pool: WHERE 첫 줄에 `g.base_game_id IS NULL` 추가 (후보 수·새 판·관리자 미리보기 모두 이 함수 경유)
-- fun_wc_ranking: items 쿼리에 `WHERE g.base_game_id IS NULL` 추가
-- 전문은 database/_LIVE/functions.sql 참고.
