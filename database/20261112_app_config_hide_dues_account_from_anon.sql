-- 회비 입금 계좌(app_config.dues_account: 은행·번호·예금주)를 비회원(anon)이 읽지 못하게 한다. (2026-11-12)
--
-- 배경: app_config 는 "Allow public read access" (TO anon,authenticated USING true) 라
--       사이트에 들어 있는 공개 키로 누구나 계좌번호·예금주 이름을 조회할 수 있었다.
-- 값은 이 파일에 적지 않는다 (저장소 공개). 기존 행의 value 는 건드리지 않는다 (2026-09-03 사고 참고).
--
-- 영향:
--   - anon: dues_account 를 뺀 나머지 키는 지금처럼 읽는다 (office_status, office_hours_config,
--           payment_check_enabled, recommendations, dues_amount — 비로그인 홈·튜토리얼·입부 폼 함수가 쓴다).
--           dues_account 는 오류가 아니라 「행 없음」으로 보인다.
--   - authenticated(키오스크 계정 포함): 지금처럼 전부 읽는다. 미납 부원 화면·dues-proof 함수(부원 토큰)는 그대로.
--   - 입부 폼 함수(member-application, anon 키)는 dues_accounts_for_form(폼 공유 비밀값)으로 계좌를 받는다.
--   - 쓰기: "Admin Manage Config" 그대로.
--
-- 새 정책을 먼저 만들고 옛 정책을 나중에 지운다 — 읽기가 비는 순간이 없다.

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

DROP POLICY "Allow public read access" ON public.app_config;

-- 입부 폼 수신 함수 전용: 폼 공유 비밀값(gas_shared_secret)이 맞을 때만 계좌 목록을 돌려준다.
-- 비밀값이 틀리거나 계좌가 없으면 빈 배열 — 판정은 금액만으로 계속된다(reason 이 amount_only 로 남을 뿐).
CREATE OR REPLACE FUNCTION public.dues_accounts_for_form(p_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_expected text;
  v_value    jsonb;
BEGIN
  SELECT value INTO v_expected FROM public.private_config WHERE key = 'gas_shared_secret';
  IF v_expected IS NULL OR coalesce(p_secret, '') <> v_expected THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT value INTO v_value FROM public.app_config WHERE key = 'dues_account';
  RETURN coalesce(v_value, '[]'::jsonb);
END;
$$;

-- ingest_member_application 과 같은 예외: Netlify 함수가 anon 키 + 공유 비밀값으로 부른다.
REVOKE EXECUTE ON FUNCTION public.dues_accounts_for_form(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dues_accounts_for_form(text) TO anon, authenticated;

-- 롤백:
-- CREATE POLICY "Allow public read access" ON public.app_config
--   AS PERMISSIVE FOR SELECT TO anon,authenticated USING (true);
-- DROP POLICY "Anon read public config" ON public.app_config;
-- DROP POLICY "Authenticated read config" ON public.app_config;
-- DROP FUNCTION public.dues_accounts_for_form(text);
