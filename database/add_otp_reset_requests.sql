-- ================================================================
-- MIGRATION: add_otp_reset_requests
-- 날짜: 2026-04-11
-- 설명: 비밀번호 재설정 OTP 저장 테이블
-- ================================================================

-- 1️⃣ OTP 요청 테이블 생성
CREATE TABLE IF NOT EXISTS public.otp_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  otp_code varchar(6) NOT NULL,
  email_sent_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  verified_at timestamptz,
  attempt_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 2️⃣ 인덱스 추가 (검색 성능)
CREATE INDEX idx_otp_user_id ON public.otp_reset_requests(user_id);
CREATE INDEX idx_otp_expires_at ON public.otp_reset_requests(expires_at);

-- 3️⃣ RLS 정책
ALTER TABLE public.otp_reset_requests ENABLE ROW LEVEL SECURITY;

-- 관리자만 조회/관리
CREATE POLICY "Admin Manage OTP" ON public.otp_reset_requests
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_admin());

-- 4️⃣ 로그 기록
INSERT INTO public.logs (action_type, details, created_at)
VALUES (
  'MIGRATION',
  jsonb_build_object(
    'description', 'OTP 재설정 요청 테이블 생성',
    'table', 'otp_reset_requests',
    'purpose', '비밀번호 재설정 2FA 보안 강화'
  ),
  NOW()
);
