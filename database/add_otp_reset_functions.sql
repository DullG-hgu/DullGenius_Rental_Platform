-- ================================================================
-- MIGRATION: add_otp_reset_functions
-- 날짜: 2026-04-11
-- 설명: 비밀번호 재설정 OTP 관련 RPC 함수
-- ================================================================

-- 1️⃣ 함수: 비밀번호 재설정 OTP 요청
-- 목적: 학번/이름/전화번호 검증 → OTP 생성 → 메일 발송
CREATE OR REPLACE FUNCTION public.request_password_reset_otp(
  p_student_id text,
  p_name text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_user_id UUID;
  v_otp_code varchar(6);
  v_email text;
  v_exists boolean;
BEGIN
  -- 1단계: 프로필 정보 대조 (학번, 이름, 전화번호)
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE student_id = p_student_id
    AND name = p_name
    AND REPLACE(phone, '-', '') = REPLACE(p_phone, '-', '');

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '입력하신 정보와 일치하는 회원을 찾을 수 없습니다.'
    );
  END IF;

  -- 2단계: 사용자 이메일 조회
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  IF v_email IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '사용자 이메일을 찾을 수 없습니다.'
    );
  END IF;

  -- 3단계: 기존 OTP 요청 확인 (1분 내에 재요청 방지)
  SELECT EXISTS(
    SELECT 1 FROM public.otp_reset_requests
    WHERE user_id = v_user_id
      AND created_at > NOW() - interval '1 minute'
      AND verified_at IS NULL
  ) INTO v_exists;

  IF v_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '1분 이내에 다시 요청해주세요. (이전 요청이 유효합니다)'
    );
  END IF;

  -- 4단계: 기존 OTP 삭제 (한 사용자당 1개만 유지)
  DELETE FROM public.otp_reset_requests
  WHERE user_id = v_user_id AND verified_at IS NULL;

  -- 5단계: 6자리 OTP 생성 (000000 ~ 999999)
  v_otp_code := LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');

  -- 6단계: OTP 저장
  INSERT INTO public.otp_reset_requests (
    user_id, student_id, name, phone, otp_code, expires_at
  )
  VALUES (
    v_user_id, p_student_id, p_name, p_phone, v_otp_code,
    NOW() + interval '10 minutes'
  );

  -- 7단계: 로그 기록
  INSERT INTO public.logs (user_id, action_type, details)
  VALUES (
    v_user_id,
    'PASSWORD_RESET_OTP_REQUESTED',
    jsonb_build_object(
      'email', v_email,
      'student_id', p_student_id,
      'timestamp', NOW()
    )
  );

  -- ⚠️ 실제 메일 발송은 외부 서비스(Netlify Function)에서 처리
  -- 응답: 메일 발송 지시
  RETURN jsonb_build_object(
    'success', true,
    'message', v_email || ' 주소로 OTP를 발송했습니다. (10분 유효)',
    'email_masked', CONCAT(SUBSTRING(v_email, 1, 3), '***@', SPLIT_PART(v_email, '@', 2))
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', '오류 발생: ' || SQLERRM
  );
END;
$function$;

-- 2️⃣ 함수: OTP 검증 후 비밀번호 변경
-- 목적: OTP 확인 → 비밀번호 변경 → 기존 otp_reset_requests 행 삭제
CREATE OR REPLACE FUNCTION public.verify_otp_and_reset_password(
  p_student_id text,
  p_otp_code varchar(6),
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_user_id UUID;
  v_attempt_count int;
BEGIN
  -- 1단계: OTP 검증 및 사용자 조회
  SELECT user_id, attempt_count INTO v_user_id, v_attempt_count
  FROM public.otp_reset_requests
  WHERE student_id = p_student_id
    AND otp_code = p_otp_code
    AND verified_at IS NULL
    AND expires_at > NOW();

  -- OTP 없음 또는 만료됨
  IF v_user_id IS NULL THEN
    -- 기존 요청 확인하여 시도 횟수 업데이트
    UPDATE public.otp_reset_requests
    SET attempt_count = attempt_count + 1
    WHERE student_id = p_student_id
      AND verified_at IS NULL
      AND expires_at > NOW();

    RETURN jsonb_build_object(
      'success', false,
      'message', '유효하지 않거나 만료된 OTP입니다. 다시 요청해주세요.'
    );
  END IF;

  -- 3회 이상 실패 방지
  IF v_attempt_count >= 3 THEN
    DELETE FROM public.otp_reset_requests
    WHERE user_id = v_user_id AND verified_at IS NULL;

    INSERT INTO public.logs (user_id, action_type, details)
    VALUES (v_user_id, 'PASSWORD_RESET_OTP_FAILED', jsonb_build_object(
      'reason', '3회 이상 OTP 검증 실패',
      'timestamp', NOW()
    ));

    RETURN jsonb_build_object(
      'success', false,
      'message', 'OTP 검증 실패 3회. 다시 처음부터 요청해주세요.'
    );
  END IF;

  -- 2단계: 비밀번호 변경
  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = NOW()
  WHERE id = v_user_id;

  -- 3단계: OTP 검증 완료 표시
  UPDATE public.otp_reset_requests
  SET verified_at = NOW()
  WHERE user_id = v_user_id AND verified_at IS NULL;

  -- 4단계: 로그 기록
  INSERT INTO public.logs (user_id, action_type, details)
  VALUES (
    v_user_id,
    'PASSWORD_RESET_SUCCESS',
    jsonb_build_object(
      'method', 'OTP',
      'timestamp', NOW()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', '비밀번호가 성공적으로 변경되었습니다. 새 비밀번호로 로그인해주세요.'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', '오류 발생: ' || SQLERRM
  );
END;
$function$;

-- 3️⃣ 유효기간 만료 OTP 정리용 함수 (매일 실행)
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_deleted_count int;
BEGIN
  DELETE FROM public.otp_reset_requests
  WHERE expires_at < NOW();

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'message', v_deleted_count || '개의 만료된 OTP 제거됨',
    'deleted_count', v_deleted_count
  );
END;
$function$;
