-- [Security Hardening] RLS 및 Soft Delete 지원 (Final Optimized)

-- 1. Profiles 테이블 스키마 변경 (Soft Delete)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'status') THEN
        ALTER TABLE public.profiles ADD COLUMN status text DEFAULT 'active';
    END IF;
END $$;

-- 기존 데이터 status 초기화 (없는 경우)
UPDATE public.profiles SET status = 'active' WHERE status IS NULL;

-- 2. RLS 정책 강화: Profiles
DROP POLICY IF EXISTS "Public Profiles" ON public.profiles;
DROP POLICY IF EXISTS "View Profiles" ON public.profiles;
DROP POLICY IF EXISTS "View Own Profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin View All Profiles" ON public.profiles;

-- (1) 본인 데이터는 본인이 조회
CREATE POLICY "View Own Profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- (2) 관리자(admin/executive)는 모든 프로필 조회 가능
CREATE POLICY "Admin View All Profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role_key IN ('admin', 'executive')
  )
);

-- 3. RLS 정책 강화: Rentals
DROP POLICY IF EXISTS "View All Rentals" ON public.rentals;
DROP POLICY IF EXISTS "View Own Rentals" ON public.rentals;
DROP POLICY IF EXISTS "Admin View All Rentals" ON public.rentals;

-- (1) 본인 대여 기록만 조회
CREATE POLICY "View Own Rentals"
ON public.rentals
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- (2) 관리자는 모든 대여 기록 조회
CREATE POLICY "Admin View All Rentals"
ON public.rentals
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role_key IN ('admin', 'executive')
  )
);

-- 4. [Soft Delete] 회원 탈퇴 RPC 재정의
CREATE OR REPLACE FUNCTION public.withdraw_user(
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_active_rentals_count integer;
    v_active_dibs_count integer;
    v_origin_student_id text;
    v_origin_email text;
    v_new_student_id text;
    v_new_email text;
BEGIN
    -- 1. 본인 확인
    IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', '권한이 없습니다.');
    END IF;

    -- 2. 미반납 대여 확인
    SELECT count(*) INTO v_active_rentals_count
    FROM public.rentals
    WHERE user_id = p_user_id
        AND type = 'RENT'
        AND returned_at IS NULL;

    IF v_active_rentals_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '반납하지 않은 게임이 있습니다.');
    END IF;

    -- 3. 찜 확인
    SELECT count(*) INTO v_active_dibs_count
    FROM public.rentals
    WHERE user_id = p_user_id
        AND type = 'DIBS'
        AND returned_at IS NULL;

    IF v_active_dibs_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '현재 찜(예약) 중인 게임이 있습니다. 취소 후 탈퇴해주세요.');
    END IF;

    -- 4. 정보 백업 및 변경 값 생성
    SELECT student_id INTO v_origin_student_id
    FROM public.profiles
    WHERE id = p_user_id;

    -- 이메일은 auth.users에서 가져오는 게 정확하지만, 여기서는 규칙 기반으로 생성
    v_origin_email := v_origin_student_id || '@handong.ac.kr';
    
    -- 충돌 방지를 위한 난수화 (deleted_timestamp_studentId)
    v_new_student_id := 'deleted_' || to_char(now(), 'YYYYMMDDHH24MISS') || '_' || v_origin_student_id;
    v_new_email := 'deleted_' || to_char(now(), 'YYYYMMDDHH24MISS') || '_' || v_origin_email;

    -- 5. 상태 변경 및 정보 보존 (Rename & Archive)
    -- 개인정보(이름, 전화번호)는 유지하되, 재가입을 위해 식별자(학번, 이메일)만 변경
    
    -- (1) Auth.users 테이블 업데이트 (이메일 변경하여 재가입 허용)
    UPDATE auth.users
    SET email = v_new_email,
        -- 메타데이터의 학번정보도 동기화 (이름은 유지)
        raw_user_meta_data = jsonb_set(
            raw_user_meta_data, 
            '{student_id}', 
            to_jsonb(v_new_student_id)
        )
    WHERE id = p_user_id;

    -- (2) Profiles 테이블 업데이트
    UPDATE public.profiles
    SET status = 'withdrawn',
        student_id = v_new_student_id
        -- name, phone은 그대로 유지 (기록 보존)
        -- email 컬럼은 profiles에 없으므로 업데이트 생략
    WHERE id = p_user_id;

    RETURN jsonb_build_object('success', true, 'message', '회원 탈퇴 처리되었습니다. 계정은 비활성화되지만 대여 기록은 동아리 운영을 위해 보존됩니다.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
