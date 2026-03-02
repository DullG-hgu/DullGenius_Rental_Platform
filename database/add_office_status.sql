-- 오피스아워 상태 초기값 추가
INSERT INTO public.app_config (key, value)
VALUES ('office_status', '{"open": false, "auto_close_at": null}')
ON CONFLICT (key) DO NOTHING;
