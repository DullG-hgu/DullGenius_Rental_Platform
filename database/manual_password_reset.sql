-- [Manual Password Reset] 관리자용 비밀번호 수동 재설정
-- 학번(student_id)으로 비밀번호를 '12345678'로 초기화합니다.

-- 아래 쿼리의 '22100123' 부분을 실제 학번으로 수정하고 실행하세요.

UPDATE auth.users
SET 
  encrypted_password = crypt('12345678', gen_salt('bf')),
  updated_at = now()
WHERE id IN (
  SELECT id FROM public.profiles WHERE student_id = '22100123' -- << 여기 학번 수정!
);
