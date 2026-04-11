-- [Fix Profile] 프로필 데이터 강제 복구 스크립트
-- Supabase SQL Editor에서 실행하세요.

DO $$
DECLARE
    v_user_id uuid;
BEGIN
    -- 1. 해당 이메일의 유저 ID(UUID) 찾기
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = '22200084@handong.ac.kr';

    -- 2. 유저가 존재하면 프로필 생성/업데이트
    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.profiles (id, student_id, name, phone, joined_semester)
        VALUES (
            v_user_id,
            '22200084',
            '김범근',  -- [중요] 여기에 본명을 강제로 넣습니다.
            '',       -- 전화번호는 비워둡니다 (필요시 업데이트)
            '2025-1'
        )
        ON CONFLICT (id) DO UPDATE
        SET name = '김범근'; -- 이미 있으면 이름만 '김범근'으로 수정

        RAISE NOTICE '✅ 프로필 복구 완료: 김범근 (22200084)';
    ELSE
        RAISE NOTICE '❌ 해당 이메일의 유저를 찾을 수 없습니다. (회원가입은 하셨나요?)';
    END IF;
END $$;
