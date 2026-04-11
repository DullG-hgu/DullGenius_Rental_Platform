-- 오피스아워 배너 설정 초기값 추가
INSERT INTO public.app_config (key, value)
VALUES ('office_hours_config', '{
  "auto_close_hour": 21,
  "auto_close_minute": 0,
  "banner_icon": "🟢",
  "banner_title": "오피스아워 진행 중!",
  "banner_subtitle": "지금 방문하시면 게임을 대여할 수 있어요",
  "banner_color": "linear-gradient(135deg, #1a5c2a, #27ae60)",
  "schedule_icon": "📅",
  "schedule_text": "",
  "offline_text": "현재 오피스아워를 운영하고 있지 않아요"
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
