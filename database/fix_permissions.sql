-- [Fix Permissions] 권한 설정 복구 스크립트
-- Supabase SQL Editor에서 실행하세요.

-- 1. Logs 테이블 권한 (모든 유저 Insert/Select 허용)
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable insert for all users" ON public.logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for all users" ON public.logs FOR SELECT USING (true);

-- 2. Game Copies 테이블 권한 (모든 유저 Update 허용 - 관리자 기능 및 대여용)
ALTER TABLE public.game_copies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable update for all users" ON public.game_copies FOR UPDATE USING (true);
CREATE POLICY "Enable insert for all users" ON public.game_copies FOR INSERT WITH CHECK (true);

-- 3. Rentals 테이블 권한 (모든 유저 Insert/Update 허용)
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable insert for all users" ON public.rentals FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON public.rentals FOR UPDATE USING (true);
CREATE POLICY "Enable select for all users" ON public.rentals FOR SELECT USING (true);

-- 4. Games 테이블 권한 (관리자 게임 추가/수정용)
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all modifications for all users" ON public.games FOR ALL USING (true);

SELECT 'Permissions Fixed' as status;
