-- ================================================================
-- MIGRATION: bgg_terms / game_bgg_terms
-- 날짜: 2026-10-04
-- 배경: 장르 정리(genres 131종 난립)의 근거 데이터로 BGG 원본 태그를 보관한다.
--   - BGG category(대부분 테마)·mechanic(진행 방식)·family 원문 그대로. family 는 family_group(접두어)으로 선별
--   - 채우는 건 scripts/bgg_terms_fetch.mjs (service role) 하나뿐. 운영자는 손대지 않는다
--   - name_ko 는 비워 두고, 정규 태그 사전(후속 B단계)에서 번역·대응을 정한다
--   - games.genres 는 건드리지 않는다 (월드컵 필터·상세 표시가 아직 genres 를 쓴다)
--
-- 접근 원칙: 게임 특성 표시용 공개 데이터 → anon·authenticated 읽기만. 쓰기 권한·정책 없음.
-- ================================================================

-- BGG 태그 사전 (id = BGG link id)
CREATE TABLE IF NOT EXISTS public.bgg_terms (
  id          int4 PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('category', 'mechanic')),
  name_en     text NOT NULL,
  name_ko     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 게임 × BGG 태그
CREATE TABLE IF NOT EXISTS public.game_bgg_terms (
  game_id     int4 NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  term_id     int4 NOT NULL REFERENCES public.bgg_terms(id) ON DELETE CASCADE,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, term_id)
);
CREATE INDEX IF NOT EXISTS game_bgg_terms_term_idx ON public.game_bgg_terms (term_id);

ALTER TABLE public.bgg_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_bgg_terms ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.bgg_terms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.game_bgg_terms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bgg_terms TO anon, authenticated;
GRANT SELECT ON public.game_bgg_terms TO anon, authenticated;

DROP POLICY IF EXISTS "Public read bgg_terms" ON public.bgg_terms;
CREATE POLICY "Public read bgg_terms" ON public.bgg_terms
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read game_bgg_terms" ON public.game_bgg_terms;
CREATE POLICY "Public read game_bgg_terms" ON public.game_bgg_terms
  FOR SELECT TO anon, authenticated USING (true);

-- ----------------------------------------------------------------
-- 2차 (같은 날): family 도 받아 두고 접두어로 쓸 묶음을 고른다
-- ----------------------------------------------------------------
ALTER TABLE public.bgg_terms DROP CONSTRAINT IF EXISTS bgg_terms_kind_check;
ALTER TABLE public.bgg_terms ADD CONSTRAINT bgg_terms_kind_check CHECK (kind IN ('category', 'mechanic', 'family'));
ALTER TABLE public.bgg_terms ADD COLUMN IF NOT EXISTS family_group text;
COMMENT ON COLUMN public.bgg_terms.family_group IS 'family 의 접두어 (예: Theme, Players, Mechanism, Admin). 쓸 만한 묶음 선별 기준';
