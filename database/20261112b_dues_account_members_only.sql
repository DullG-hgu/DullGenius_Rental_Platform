-- 회비 계좌를 「로그인만 하면」 읽을 수 있던 것을 낼 사람 본인에게만 내려주게 좁힌다. (2026-11-12)
--
-- 배경: 가입은 학번 8자리만 맞으면 누구나 된다. 20261112_app_config_hide_dues_account_from_anon.sql 로
--       비회원은 막았지만, 계정을 만들어 로그인하면 app_config 에서 계좌·예금주를 그대로 읽을 수 있었다.
--
-- 바뀌는 것:
--   - authenticated 도 app_config 에서 dues_account 행을 직접 읽지 못한다 (행 없음으로 보인다).
--     관리자·운영진은 "Admin Manage Config"(is_admin) 정책으로 지금처럼 읽고 쓴다.
--   - 부원은 dues_my_accounts() 로 받는다. 돌려주는 조건:
--       관리자, 또는 _dues_eligibility = 'ok' (예전에 낸 적이 있거나 입부 신청이 있는 미납 부원).
--     처음 가입만 하고 입부 신청이 없는 계정(need_form)·이미 낸 부원·면제 역할·키오스크 계정에는 빈 배열.
--   - dues-proof 함수(부원 토큰)·상세 화면이 이 RPC 를 쓴다.
-- 기존 행의 value 는 건드리지 않는다.

CREATE OR REPLACE FUNCTION public.dues_my_accounts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_value jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT (public.is_admin() OR public._dues_eligibility(v_uid) = 'ok') THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT value INTO v_value FROM public.app_config WHERE key = 'dues_account';
  RETURN coalesce(v_value, '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dues_my_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dues_my_accounts() TO authenticated;

ALTER POLICY "Authenticated read config" ON public.app_config USING (key <> 'dues_account');

-- 롤백:
-- ALTER POLICY "Authenticated read config" ON public.app_config USING (true);
-- DROP FUNCTION public.dues_my_accounts();
