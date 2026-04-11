-- [SECURE FIX] RLS 취약점 보안 패치
-- 이 스크립트를 Supabase SQL Editor에서 실행하여, 'fix_permissions.sql'로 인해 열린 권한을 닫으십시오.

-- 1. Games 테이블 잠금 (관리자만 수정 가능하게/RPC 사용)
DROP POLICY IF EXISTS "Enable all modifications for all users" ON public.games;
CREATE POLICY "Allow public read access" ON public.games FOR SELECT USING (true);

-- 2. Rentals 테이블 잠금
DROP POLICY IF EXISTS "Enable insert for all users" ON public.rentals;
DROP POLICY IF EXISTS "Enable update for all users" ON public.rentals;
DROP POLICY IF EXISTS "Enable select for all users" ON public.rentals;

-- 본인 것만 조회 가능 (기본 보안)
CREATE POLICY "View own rentals" ON public.rentals FOR SELECT USING (auth.uid() = user_id);

-- 3. Game Copies 테이블 잠금
DROP POLICY IF EXISTS "Enable update for all users" ON public.game_copies;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.game_copies;
DROP POLICY IF EXISTS "Enable select for all users" ON public.game_copies; 

CREATE POLICY "Allow public read copies" ON public.game_copies FOR SELECT USING (true);

-- 4. Logs 테이블 잠금
DROP POLICY IF EXISTS "Enable insert for all users" ON public.logs;
DROP POLICY IF EXISTS "Enable select for all users" ON public.logs;

-- [결론]
-- 이 스크립트는 누구나 DB를 조작할 수 있는 '개발용 임시 허용 정책'을 제거합니다.
-- 정상적인 기능(대여/반납 등)은 harden_core_logic.sql의 RPC 함수가 SECURITY DEFINER 권한으로 처리하므로 안전하게 작동합니다.
