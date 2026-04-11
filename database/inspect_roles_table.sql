-- ============================================================
-- [roles 테이블 구조 확인 스크립트]
-- Supabase SQL Editor에서 실행하여 실제 테이블 구조를 확인하세요.
-- ============================================================

-- 1. roles 테이블의 컬럼 정보 확인
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM 
    information_schema.columns
WHERE 
    table_schema = 'public'
    AND table_name = 'roles'
ORDER BY 
    ordinal_position;

-- 2. roles 테이블의 제약조건 확인 (PRIMARY KEY, FOREIGN KEY 등)
SELECT
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name
FROM 
    information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
WHERE 
    tc.table_schema = 'public'
    AND tc.table_name = 'roles';

-- 3. roles 테이블의 현재 데이터 확인
SELECT * FROM public.roles;

-- 4. user_roles 테이블의 컬럼 정보 확인
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM 
    information_schema.columns
WHERE 
    table_schema = 'public'
    AND table_name = 'user_roles'
ORDER BY 
    ordinal_position;

-- 5. user_roles 테이블의 현재 데이터 확인
SELECT * FROM public.user_roles;
