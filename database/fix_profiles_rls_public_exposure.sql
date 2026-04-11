-- ================================================================
-- MIGRATION: fix_profiles_rls_public_exposure
-- 날짜: 2026-04-11
-- 설명: 보안 취약점 - profiles 테이블 RLS 정책 수정
-- 문제: "Public Read" 정책의 USING (true)로 모든 사용자 정보 노출
-- 해결: 본인 프로필만 읽을 수 있도록 제한, 관리자는 모두 읽음
-- ================================================================

-- 1️⃣ 기존 "Public Read" 정책 삭제 (모든 사용자 정보 공개)
DROP POLICY IF EXISTS "Public Read" ON public.profiles;

-- 2️⃣ 새 정책: 인증된 사용자가 본인 프로필만 읽음
CREATE POLICY "Authenticated users read own profile" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 3️⃣ 관리자 정책 확인 (기존 정책 유지)
-- "Admin Read All Profiles" - 관리자가 모든 프로필 조회 가능
-- "Admin View All Profiles" - 관리자(admin, executive)가 모든 프로필 조회 가능
-- "Admin Manage Profiles" - 관리자가 모든 작업 가능

-- 4️⃣ 로그 기록
INSERT INTO public.logs (action_type, details, created_at)
VALUES (
  'SECURITY_PATCH',
  jsonb_build_object(
    'description', 'RLS 정책 수정: profiles 테이블 "Public Read" 정책 제거',
    'reason', '모든 사용자의 학번, 이름, 전화번호 노출 방지 (CVSS 9.1 High)',
    'change', 'USING (true) → USING (auth.uid() = id)',
    'affected_policy', 'Public Read',
    'severity', 'CRITICAL'
  ),
  NOW()
);
