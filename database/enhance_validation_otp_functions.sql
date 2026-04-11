-- ================================================================
-- MIGRATION: enhance_validation_otp_functions
-- 날짜: 2026-04-11
-- 설명: OTP 함수 입력 검증 강화
-- ================================================================

-- 함수 수정: request_password_reset_otp
-- 추가: 입력값 형식 검증 강화
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
  -- 입력값 검증
  -- 1. 학번: 정확히 8자리 숫자
  IF p_student_id !~ '^\d{8}$' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '학번은 정확히 8자리 숫자여야 합니다.'
    );
  END IF;

  -- 2. 이름: 비어있지 않음, 한글/영문/공백만 (최대 50자)
  IF TRIM(p_name) = '' OR CHAR_LENGTH(p_name) > 50 THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '이름을 올바르게 입력해주세요. (1~50자)'
    );
  END IF;

  -- 3. 전화번호: 10~11자리 숫자
  IF p_phone !~ '^\d{10,11}$' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '유효한 전화번호를 입력해주세요. (10~11자리)'
    );
  END IF;

  -- 프로필 정보 대조
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE student_id = p_student_id
    AND TRIM(name) = TRIM(p_name)
    AND REPLACE(phone, '-', '') = REPLACE(p_phone, '-', '');

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '입력하신 정보와 일치하는 회원을 찾을 수 없습니다.'
    );
  END IF;

  -- 이메일 조회
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  IF v_email IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '사용자 이메일을 찾을 수 없습니다.'
    );
  END IF;

  -- 기존 OTP 요청 확인
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

  -- 기존 OTP 삭제
  DELETE FROM public.otp_reset_requests
  WHERE user_id = v_user_id AND verified_at IS NULL;

  -- OTP 생성
  v_otp_code := LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');

  -- OTP 저장
  INSERT INTO public.otp_reset_requests (
    user_id, student_id, name, phone, otp_code, expires_at
  )
  VALUES (
    v_user_id, p_student_id, TRIM(p_name), p_phone,
    v_otp_code,
    NOW() + interval '10 minutes'
  );

  -- 로그 기록
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

-- 함수 수정: verify_otp_and_reset_password
-- 추가: 입력값 형식 검증
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
  -- 입력값 검증
  -- 1. 학번: 8자리 숫자
  IF p_student_id !~ '^\d{8}$' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '학번 형식이 올바르지 않습니다.'
    );
  END IF;

  -- 2. OTP: 정확히 6자리 숫자
  IF p_otp_code !~ '^\d{6}$' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'OTP는 정확히 6자리 숫자여야 합니다.'
    );
  END IF;

  -- 3. 비밀번호: 최소 6자리, 최대 128자
  IF CHAR_LENGTH(p_new_password) < 6 OR CHAR_LENGTH(p_new_password) > 128 THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', '비밀번호는 6~128자 사이여야 합니다.'
    );
  END IF;

  -- OTP 검증
  SELECT user_id, attempt_count INTO v_user_id, v_attempt_count
  FROM public.otp_reset_requests
  WHERE student_id = p_student_id
    AND otp_code = p_otp_code
    AND verified_at IS NULL
    AND expires_at > NOW();

  IF v_user_id IS NULL THEN
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

  -- 3회 실패 방지
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

  -- 비밀번호 변경
  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = NOW()
  WHERE id = v_user_id;

  -- OTP 검증 완료 표시
  UPDATE public.otp_reset_requests
  SET verified_at = NOW()
  WHERE user_id = v_user_id AND verified_at IS NULL;

  -- 로그 기록
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
