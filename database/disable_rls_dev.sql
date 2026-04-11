-- ==========================================
-- 🚧 DEVELOPMENT ONLY: DISABLE RLS (Fixed) 🚧
-- ==========================================
-- 개발 중 편의를 위해 주요 테이블의 RLS를 해제합니다.
-- dibs 테이블은 존재하지 않으므로 제외했습니다.

ALTER TABLE public.games DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rentals DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews DISABLE ROW LEVEL SECURITY;

-- 확인 (테이블 존재 여부에 따라 실행)
-- 만약 dibs 테이블이 추후 생성된다면 아래 주석 해제하여 사용하세요.
-- ALTER TABLE public.dibs DISABLE ROW LEVEL SECURITY;

SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';
