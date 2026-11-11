-- 회비 입금 계좌(app_config.dues_account)를 비회원(anon)이 읽지 못하게 한다. (2026-11-11, 미적용 초안)
--
-- 배경: app_config 는 "Allow public read access" (TO anon,authenticated USING true) 로 모든 행이 비회원에게 열려 있다.
--       관리자 오피스아워 탭에서 입력하는 회비 계좌는 로그인한 회원에게만 보여 주면 된다.
-- 값은 이 파일에 적지 않는다 (저장소 공개). 계좌는 관리자 화면에서 입력한다.
-- 기존 행의 value 는 건드리지 않는다 (2026-09-03 설정 덮어쓰기 사고 참고).
--
-- 영향:
--   - anon: dues_account 를 뺀 나머지 키는 지금처럼 읽는다 (office_status, office_hours_config,
--           payment_check_enabled, recommendations 등 — 비로그인 홈·튜토리얼이 쓴다).
--   - authenticated(키오스크 계정 포함): 지금처럼 전부 읽는다.
--   - 쓰기: "Admin Manage Config" 그대로.
-- 한 트랜잭션으로 적용해 정책이 비는 순간이 없게 한다.

BEGIN;

DROP POLICY "Allow public read access" ON public.app_config;

CREATE POLICY "Anon read public config" ON public.app_config
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING (key <> 'dues_account');

CREATE POLICY "Authenticated read config" ON public.app_config
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);

COMMIT;

-- 롤백:
-- BEGIN;
-- DROP POLICY "Anon read public config" ON public.app_config;
-- DROP POLICY "Authenticated read config" ON public.app_config;
-- CREATE POLICY "Allow public read access" ON public.app_config
--   AS PERMISSIVE FOR SELECT TO anon,authenticated USING (true);
-- COMMIT;
