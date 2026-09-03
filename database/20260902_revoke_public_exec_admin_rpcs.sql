-- ================================================================
-- MIGRATION: revoke_public_exec_admin_rpcs
-- 날짜: 2026-09-02
-- 배경: 20260902_harden_rental_rpcs_and_anon_grants 에서 관리자 RPC 7개에
--       `REVOKE EXECUTE ... FROM anon` 을 했지만, 이 함수들의 ACL에는 anon 항목이 아니라
--       PUBLIC 항목(`=X/postgres`)이 있었다. PUBLIC 권한은 anon을 포함하므로 회수가 무효였고,
--       새로 만든 `_LIVE/grants.sql` 이 이를 잡아냈다.
--
-- 교훈: 함수 EXECUTE 를 닫을 때는 반드시 `REVOKE ... FROM PUBLIC` 을 함께 쓴다.
--       (CREATE FUNCTION 기본값이 PUBLIC EXECUTE 이다)
-- ================================================================

REVOKE EXECUTE ON FUNCTION public.admin_update_user_roles(uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_activity FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_rankings FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_summary FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_timeline FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_game_purchase_requests FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_unavailable_game_views FROM PUBLIC;

-- authenticated 는 유지 (관리자도 authenticated 롤이며, 본문의 is_admin() 검사가 관문)
