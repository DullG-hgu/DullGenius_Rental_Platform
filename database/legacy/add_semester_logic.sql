-- 1. profiles 테이블에 가입 학기 관련 컬럼 추가 (안전하게 처리)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'joined_semester') THEN
        ALTER TABLE public.profiles ADD COLUMN joined_semester text DEFAULT '2025-1';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'is_semester_fixed') THEN
        ALTER TABLE public.profiles ADD COLUMN is_semester_fixed boolean DEFAULT false;
    END IF;
END $$;

-- 2. 가입 학기 본인 수정 RPC 함수
CREATE OR REPLACE FUNCTION public.update_my_semester(new_semester text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_fixed boolean;
BEGIN
  -- 1. 현재 고정 여부 확인
  SELECT is_semester_fixed INTO v_is_fixed
  FROM public.profiles
  WHERE id = v_user_id;

  -- 2. 이미 고정된 경우 수정 불가
  IF v_is_fixed THEN
    RETURN json_build_object('success', false, 'message', '이미 가입 학기가 확정되어 수정할 수 없습니다.');
  END IF;

  -- 3. 업데이트 및 고정 (최초 1회만 가능하도록)
  UPDATE public.profiles
  SET joined_semester = new_semester,
      is_semester_fixed = true
  WHERE id = v_user_id;

  RETURN json_build_object('success', true, 'message', '가입 학기가 저장되었습니다.');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'message', SQLERRM);
END;
$$;

-- 3. 회원가입 시 가입 학기 자동 계산 트리거 함수 업데이트
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
        COALESCE(v_meta_student_id, 'GUEST_' || substr(new.id::text, 1, 8)),
        COALESCE(v_allowed_name, v_meta_name, 'Unknown'),
        COALESCE(v_allowed_phone, v_meta_phone, ''),
        v_auto_semester -- 자동 계산된 학기
    );

    -- 역할 부여
    INSERT INTO public.user_roles (user_id, role_key)
    VALUES (
        new.id, 
        COALESCE(v_allowed_role, 'member')
    );

    RETURN new;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Profile creation failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
