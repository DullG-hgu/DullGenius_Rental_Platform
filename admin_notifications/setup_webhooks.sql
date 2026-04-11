-- [Setup] Database Webhooks for Discord Notifications
-- 이 스크립트는 Supabase Dashboard의 SQL Editor에서 실행해야 합니다.
-- 먼저 Edge Function을 배포하고 URL을 확인해야 합니다.
-- (Supabase Dashboard -> Database -> Webhooks 에서 GUI로 설정하는 것이 더 쉬울 수 있습니다)

-- 1. Enable pg_net extension (Required for webhooks)
create extension if not exists pg_net;

-- 2. Create a generic trigger function to call the Edge Function
-- 주의: 아래 URL은 실제 배포된 Edge Function URL로 교체해야 합니다.
-- 예: https://<project-ref>.supabase.co/functions/v1/discord-notify
-- 또한 Authorization 헤더에 Bearer Token이 필요할 수 있습니다 (Anon Key).

-- NOTE: SQL로 Webhook 설정은 복잡하므로, 가장 쉬운 방법은
-- Supabase Dashboard > Database > Webhooks > Create Webhook 메뉴를 사용하는 것입니다.
-- 아래는 참고용 트리거 설정입니다.

/*
-- Example Trigger (Pseudo-code, prefer GUI)
create trigger on_profile_created
after insert on public.profiles
for each row execute function supabase_functions.http_request(
  'https://your-project.supabase.co/functions/v1/discord-notify',
  'POST',
  '{"Content-type":"application/json"}',
  '{}', -- payload
  '1000' -- timeout
);
*/

-- 따라서 이 파일은 사용자 가이드용으로 남겨둡니다.
-- README.md를 참조하세요.
