-- [Migration] Rentals 테이블에 renter_name 컬럼 추가
-- 설명: 관리자가 수기로 대여할 때(비회원/이름만 입력), user_id 없이 이름을 저장하기 위함.

ALTER TABLE public.rentals 
ADD COLUMN IF NOT EXISTS renter_name text;

-- 기존 데이터 마이그레이션 (옵션)
-- user_id가 있는 경우 profiles에서 이름을 가져와 채워넣을 수 있으나, 
-- 일단 user_id가 null인 경우만 renter_name을 사용하도록 로직을 짤 예정.

SELECT 'Column Added' as status;
