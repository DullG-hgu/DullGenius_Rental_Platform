-- [Fix Auth] 인증 관련 트리거 및 테이블 복구 스크립트
-- 이 스크립트를 Supabase SQL Editor에서 실행하세요.

-- 1. 혹시 모를 충돌 데이터 정리 (해당 학번의 프로필이 이미 있다면 삭제)
-- (주의: 실제 운영 중이라면 함부로 지우면 안 되지만, 초기 개발 단계이므로 정리합니다)
-- DELETE FROM public.profiles WHERE student_id = '22200084'; -- [Safe Comment Out]

-- 2. Profiles 테이블이 존재하는지 확인 (없으면 생성)
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    student_id text UNIQUE NOT NULL,
    name text NOT NULL,
    phone text,
    is_paid boolean DEFAULT false,
    penalty integer DEFAULT 0,
    joined_semester text,
    activity_point integer DEFAULT 0,
    is_semester_fixed boolean DEFAULT false, -- [NEW] 가입학기 확정 여부
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- [NEW] 기존 테이블에 컬럼 추가 (이미 테이블이 있는 경우 대비)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'is_semester_fixed') THEN
        ALTER TABLE public.profiles ADD COLUMN is_semester_fixed boolean DEFAULT false;
    END IF;
END $$;

-- 3. Allowed Users 테이블 확인
CREATE TABLE IF NOT EXISTS public.allowed_users (
    student_id text PRIMARY KEY,
    name text NOT NULL,
    phone text,
    role text DEFAULT 'member',
    joined_semester text
);

-- 4. User Roles 테이블 확인
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    role_key text NOT NULL, -- role table fk는 생략(간소화)하거나 유지
    assigned_at timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, role_key)
);

-- 5. Trigger Function 재정의 (디버깅 강화 및 예외 처리)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
DECLARE
    v_allowed_name text;
    v_allowed_role text;
    v_allowed_phone text;
    v_allowed_semester text;
    v_meta_student_id text;
    v_meta_name text;
    v_meta_phone text;
    
    -- [NEW] 자동 학기 계산 변수
    v_month integer;
    v_year text;
    v_auto_semester text;
BEGIN
    -- 메타데이터에서 값 추출
    v_meta_student_id := new.raw_user_meta_data->>'student_id';
    v_meta_name := new.raw_user_meta_data->>'name';
    v_meta_phone := new.raw_user_meta_data->>'phone';

    -- Allowed Users 조회 (화이트리스트)
    SELECT name, role, phone, joined_semester 
    INTO v_allowed_name, v_allowed_role, v_allowed_phone, v_allowed_semester
    FROM public.allowed_users
    WHERE student_id = v_meta_student_id;

    -- [NEW] 가입 학기 자동 계산 로직
    IF v_allowed_semester IS NOT NULL THEN
        v_auto_semester := v_allowed_semester; -- 화이트리스트에 있으면 그거 사용
    ELSE
        v_month := extract(month from now());
        v_year := to_char(now(), 'YYYY');
        IF v_month <= 6 THEN
            v_auto_semester := v_year || '-1';
        ELSE
            v_auto_semester := v_year || '-2';
        END IF;
    END IF;

    -- 프로필 생성
    INSERT INTO public.profiles (id, student_id, name, phone, joined_semester)
    VALUES (
        new.id, 
        -- 학번이 없으면(Guest) 임시 ID 생성
        COALESCE(v_meta_student_id, 'GUEST_' || substr(new.id::text, 1, 8)),
        -- 이름: 화이트리스트 -> 입력값 -> Unknown 순
        COALESCE(v_allowed_name, v_meta_name, 'Unknown'),
        -- 전화번호
        COALESCE(v_allowed_phone, v_meta_phone, ''),
        -- 가입학기 (자동 계산됨)
        v_auto_semester
    );

    -- 역할 부여
    INSERT INTO public.user_roles (user_id, role_key)
    VALUES (
        new.id, 
        COALESCE(v_allowed_role, 'member') -- 기본값 member
    );

    RETURN new;
EXCEPTION WHEN OTHERS THEN
    -- 에러 발생 시 로그를 남기거나 (Supabase 로그 확인 가능), 일단 실패를 던짐
    RAISE EXCEPTION 'Profile creation failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Trigger 재연결
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 7. [NEW] 본인 가입 학기 1회 수정 RPC
CREATE OR REPLACE FUNCTION public.update_my_semester(
    new_semester text
) RETURNS jsonb AS $$
DECLARE
    v_is_fixed boolean;
BEGIN
    -- 현재 상태 확인
    SELECT is_semester_fixed INTO v_is_fixed
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_is_fixed THEN
         RETURN jsonb_build_object('success', false, 'message', '이미 가입 학기를 확정했습니다. 수정할 수 없습니다.');
    END IF;

    -- 업데이트 및 확정
    UPDATE public.profiles
    SET joined_semester = new_semester,
        is_semester_fixed = true
    WHERE id = auth.uid();

    RETURN jsonb_build_object('success', true, 'message', '가입 학기가 등록되었습니다.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. 확인 메시지
SELECT 'Fixed Auth Schema & Added Semester Logic' as status;
