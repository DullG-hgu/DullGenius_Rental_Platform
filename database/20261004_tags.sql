-- ================================================================
-- MIGRATION: tags / game_tags / bgg_terms.tag_id
-- 날짜: 2026-10-04
-- 배경: genres(131종 난립)를 대신할 정규 분류. 사용자가 게임 특성을 알게 하는 게 목표이고,
--   추천·MBTI 연결의 기반 데이터가 된다.
--   - 층(layer): play 진행 방식(핵심 재미 후보) / theme 테마 / format 형식 / side 편 종류
--   - 게임마다 play 중 하나를 핵심 재미(is_core)로 표시 → 대여 목록에는 이 한 단어만
--   - 편 「개인전」은 기본값이라 행을 만들지 않는다 (side 행이 없으면 개인전)
--   - 출처(source): bgg 대응표 / genre 기존 운영자 장르 대응 / jev 제안 / operator 운영자
--     jev 는 confirmed=false 로 넣고 운영자가 확정하기 전엔 사용자에게 보이지 않는다
--   - games.genres 는 아직 건드리지 않는다 (화면 전환은 후속)
--
-- 접근 원칙: 공개 데이터 → anon·authenticated 읽기만. 쓰기는 service role(스크립트).
--   관리자 확정 화면을 만들 때 쓰기 정책·RPC 를 따로 추가한다.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.tags (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  layer       text NOT NULL CHECK (layer IN ('play', 'theme', 'format', 'side')),
  grp         text,             -- play 묶음 (키워 가기·판 위에서·사람 사이·머리·몸·운·카드·표현)
  sort        int4 NOT NULL DEFAULT 0,
  description text,             -- Jev 판정용 정의 (영문)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_tags (
  game_id     int4 NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  tag_id      int4 NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  is_core     bool NOT NULL DEFAULT false,
  source      text NOT NULL CHECK (source IN ('bgg', 'genre', 'jev', 'operator')),
  confirmed   bool NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, tag_id)
);
CREATE INDEX IF NOT EXISTS game_tags_tag_idx ON public.game_tags (tag_id);
-- 핵심 재미는 게임당 하나
CREATE UNIQUE INDEX IF NOT EXISTS game_tags_one_core ON public.game_tags (game_id) WHERE is_core;

ALTER TABLE public.bgg_terms ADD COLUMN IF NOT EXISTS tag_id int4 REFERENCES public.tags(id) ON DELETE SET NULL;

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.game_tags FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tags TO anon, authenticated;
GRANT SELECT ON public.game_tags TO anon, authenticated;

DROP POLICY IF EXISTS "Public read tags" ON public.tags;
CREATE POLICY "Public read tags" ON public.tags
  FOR SELECT TO anon, authenticated USING (true);

-- 미확정 jev 제안은 숨긴다
DROP POLICY IF EXISTS "Public read confirmed game_tags" ON public.game_tags;
CREATE POLICY "Public read confirmed game_tags" ON public.game_tags
  FOR SELECT TO anon, authenticated USING (confirmed OR source <> 'jev');

-- 정규 분류 사전 (2026-10-04 확정안)
INSERT INTO public.tags (name, layer, grp, sort) VALUES
  ('엔진빌딩','play','키워 가기',101), ('자원관리','play','키워 가기',102), ('일꾼배치','play','키워 가기',103),
  ('덱빌딩','play','키워 가기',104), ('드래프트','play','키워 가기',105), ('캠페인','play','키워 가기',106),
  ('타일놓기','play','판 위에서',201), ('길 잇기','play','판 위에서',202), ('땅따먹기','play','판 위에서',203),
  ('셋컬렉션','play','판 위에서',204), ('추상전략','play','판 위에서',205), ('퍼즐','play','판 위에서',206),
  ('블러핑','play','사람 사이',301), ('마피아','play','사람 사이',302), ('협상','play','사람 사이',303),
  ('경매','play','사람 사이',304), ('견제','play','사람 사이',305), ('투표','play','사람 사이',306),
  ('추리','play','머리',401), ('기억력','play','머리',402), ('숫자','play','머리',403),
  ('퀴즈','play','머리',404), ('단어','play','머리',405),
  ('순발력','play','몸·운',501), ('손기술','play','몸·운',502), ('주사위','play','몸·운',503),
  ('운 걸기','play','몸·운',504), ('레이스','play','몸·운',505), ('롤앤라이트','play','몸·운',506),
  ('트릭테이킹','play','카드',601), ('클라이밍','play','카드',602),
  ('그림·몸짓','play','표현',701), ('역할극','play','표현',702), ('비대칭 능력','play','표현',703),
  ('판타지','theme',NULL,1001), ('SF','theme',NULL,1002), ('호러','theme',NULL,1003), ('미스터리','theme',NULL,1004),
  ('동물','theme',NULL,1005), ('자연','theme',NULL,1006), ('역사','theme',NULL,1007), ('전쟁','theme',NULL,1008),
  ('모험','theme',NULL,1009), ('유머','theme',NULL,1010), ('신화','theme',NULL,1011), ('스파이','theme',NULL,1012),
  ('원작','theme',NULL,1013),
  ('파티','format',NULL,2001), ('카드','format',NULL,2002), ('2인 전용','format',NULL,2003), ('솔로','format',NULL,2004),
  ('가족','format',NULL,2005), ('방탈출','format',NULL,2006), ('머더미스터리','format',NULL,2007), ('TRPG','format',NULL,2008),
  ('협력','side',NULL,3001), ('팀전','side',NULL,3002), ('숨은 팀','side',NULL,3003), ('반협력','side',NULL,3004),
  ('승패 없음','side',NULL,3005)
ON CONFLICT (name) DO NOTHING;
