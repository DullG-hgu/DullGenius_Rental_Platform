-- [Cleanup] 마이그레이션이 끝난 임시 테이블을 정리합니다.

DROP TABLE IF EXISTS public.raw_reviews;
DROP TABLE IF EXISTS public.raw_rentals;
DROP TABLE IF EXISTS public.raw_games;

-- 참고: fix_integers.sql이나 migration_fix.sql도 더 이상 필요 없습니다.
