-- 회비 이체 캡처 인증 + 입부 신청 수신 (spec_dues_capture.md)
-- 적용: mcp apply_migration. 적용 직후 pull-schema 를 바로 돌리지 않는다 (Nano 정지 전례).
-- app_config 값은 여기서 건드리지 않는다 (dues_amount·dues_account 는 관리자 화면에서 입력).

-- ── 0. 학기 계산 (KST, 1~6월 = -1, 7~12월 = -2). 화면의 getCurrentSemester() 와 같은 기준 ──
CREATE OR REPLACE FUNCTION public._dues_semester(p_at timestamptz DEFAULT now())
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT to_char(p_at AT TIME ZONE 'Asia/Seoul', 'YYYY') || '-' ||
         CASE WHEN extract(month FROM p_at AT TIME ZONE 'Asia/Seoul') <= 6 THEN '1' ELSE '2' END;
$$;
REVOKE EXECUTE ON FUNCTION public._dues_semester(timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 1. 테이블 ──
CREATE TABLE IF NOT EXISTS public.dues_proofs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES public.profiles(id) ON DELETE CASCADE,  -- 가입 전에 폼으로 낸 건은 null
  student_id   text NOT NULL,
  semester     text NOT NULL,
  source       text NOT NULL DEFAULT 'site' CHECK (source IN ('site', 'form', 'admin')),
  status       text NOT NULL CHECK (status IN ('approved', 'pending_review', 'rejected', 'revoked')),
  reason       text,
  amount       int,
  account_tail text,
  image_path   text,          -- 보관소 경로(site) 또는 구글 드라이브 파일 id(form). 학기 종료 삭제 뒤 null
  file_hash    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid,
  reviewed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS dues_proofs_semester_idx ON public.dues_proofs (semester, created_at DESC);
CREATE INDEX IF NOT EXISTS dues_proofs_user_idx     ON public.dues_proofs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dues_proofs_student_idx  ON public.dues_proofs (student_id, semester);
CREATE INDEX IF NOT EXISTS dues_proofs_hash_idx     ON public.dues_proofs (file_hash);
ALTER TABLE public.dues_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dues_proofs FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.member_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   text NOT NULL,
  name         text,
  phone        text,
  department   text,
  track        text,
  semester     text NOT NULL,
  submitted_at timestamptz,
  received_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, semester)
);
ALTER TABLE public.member_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_applications FROM PUBLIC, anon, authenticated;

-- ── 2. 비밀값 (Netlify 함수 → dues_submit_proof). 값은 DB 가 만들고 여기 적지 않는다 ──
-- 적용 후 Supabase 대시보드 Table Editor → private_config 에서 값을 복사해 Netlify 환경변수 DUES_RPC_SECRET 에 넣는다.
INSERT INTO public.private_config (key, value)
VALUES ('dues_rpc_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

-- ── 3. 올릴 자격 (내부) ──
-- paid: 이미 납부 / exempt: 면제 역할 / ok: 올릴 수 있음 / need_form: 처음인데 입부 신청이 없음
CREATE OR REPLACE FUNCTION public._dues_eligibility(p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_p public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.profiles WHERE id = p_user;
  IF NOT FOUND THEN RETURN 'no_profile'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role_key IN ('admin', 'executive', 'payment_exempt')) THEN
    RETURN 'exempt';
  END IF;
  IF v_p.is_paid THEN RETURN 'paid'; END IF;
  IF v_p.last_paid_semester IS NOT NULL THEN RETURN 'ok'; END IF;
  IF EXISTS (SELECT 1 FROM public.member_applications
             WHERE student_id = regexp_replace(v_p.student_id, '\D', '', 'g')) THEN
    RETURN 'ok';
  END IF;
  RETURN 'need_form';
END;
$$;
REVOKE EXECUTE ON FUNCTION public._dues_eligibility(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. 부원: 내 상태 (가입 전에 폼으로 낸 회비가 있으면 여기서 연결한다) ──
CREATE OR REPLACE FUNCTION public.dues_my_proof_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_sem      text := public._dues_semester();
  v_sid      text;
  v_elig     text;
  v_claimed  boolean := false;
  v_latest   jsonb;
  v_today    int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('eligibility', 'no_profile');
  END IF;
  SELECT regexp_replace(student_id, '\D', '', 'g') INTO v_sid FROM public.profiles WHERE id = v_uid;
  v_elig := public._dues_eligibility(v_uid);

  -- 선납 연결: 같은 학기에 내 학번으로 허가된, 아직 주인 없는 기록
  IF v_elig IN ('ok', 'need_form') AND v_sid <> '' THEN
    UPDATE public.dues_proofs SET user_id = v_uid
     WHERE user_id IS NULL AND student_id = v_sid AND semester = v_sem AND status = 'approved';
    IF FOUND THEN
      UPDATE public.profiles SET is_paid = true, last_paid_semester = v_sem WHERE id = v_uid;
      INSERT INTO public.logs (user_id, action_type, details)
      VALUES (v_uid, 'DUES_PROOF', jsonb_build_object('status', 'approved', 'reason', 'prepaid_claimed', 'semester', v_sem));
      v_claimed := true;
      v_elig := 'paid';
    END IF;
  END IF;

  SELECT jsonb_build_object('status', status, 'reason', reason, 'created_at', created_at)
    INTO v_latest
    FROM public.dues_proofs
   WHERE user_id = v_uid AND semester = v_sem
   ORDER BY created_at DESC LIMIT 1;

  SELECT count(*) INTO v_today FROM public.dues_proofs
   WHERE user_id = v_uid AND status = 'rejected'
     AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';

  RETURN jsonb_build_object(
    'eligibility', v_elig, 'semester', v_sem, 'claimed', v_claimed,
    'latest', v_latest, 'rejected_today', v_today, 'daily_limit', 5);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dues_my_proof_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dues_my_proof_status() TO authenticated;

-- ── 5. Netlify 함수: 판정 결과 기록 (부원 토큰 + 서버 비밀값) ──
-- 부원이 직접 불러 「허가」를 써넣지 못하게 비밀값을 확인한다.
CREATE OR REPLACE FUNCTION public.dues_submit_proof(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_expected text;
  v_sem      text := public._dues_semester();
  v_sid      text;
  v_elig     text;
  v_status   text := p_payload->>'status';
  v_reason   text := p_payload->>'reason';
  v_hash     text := nullif(p_payload->>'file_hash', '');
  v_today    int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth');
  END IF;
  SELECT value INTO v_expected FROM public.private_config WHERE key = 'dues_rpc_secret';
  IF v_expected IS NULL OR coalesce(p_payload->>'secret', '') <> v_expected THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  IF v_status NOT IN ('approved', 'pending_review', 'rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_status');
  END IF;

  v_elig := public._dues_eligibility(v_uid);
  IF v_elig <> 'ok' THEN
    RETURN jsonb_build_object('success', false, 'error', v_elig);
  END IF;

  SELECT count(*) INTO v_today FROM public.dues_proofs
   WHERE user_id = v_uid AND status = 'rejected'
     AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  IF v_today >= 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'daily_limit');
  END IF;

  SELECT regexp_replace(student_id, '\D', '', 'g') INTO v_sid FROM public.profiles WHERE id = v_uid;

  -- 같은 파일이 이미 쓰였으면 반려 (지난 학기분·다른 사람 것 포함)
  IF v_status = 'approved' AND v_hash IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.dues_proofs WHERE file_hash = v_hash AND status IN ('approved', 'revoked')) THEN
    v_status := 'rejected'; v_reason := 'duplicate';
  END IF;
  -- 이번 학기에 되돌려진 적이 있으면 자동 허가하지 않는다
  IF v_status = 'approved'
     AND EXISTS (SELECT 1 FROM public.dues_proofs WHERE user_id = v_uid AND semester = v_sem AND status = 'revoked') THEN
    v_status := 'pending_review'; v_reason := 'revoked_before';
  END IF;

  INSERT INTO public.dues_proofs (user_id, student_id, semester, source, status, reason, amount, account_tail, image_path, file_hash)
  VALUES (v_uid, v_sid, v_sem, 'site', v_status, v_reason,
          nullif(p_payload->>'amount', '')::int, nullif(p_payload->>'account_tail', ''),
          nullif(p_payload->>'image_path', ''), v_hash);

  IF v_status = 'approved' THEN
    UPDATE public.profiles SET is_paid = true, last_paid_semester = v_sem WHERE id = v_uid;
  END IF;
  INSERT INTO public.logs (user_id, action_type, details)
  VALUES (v_uid, 'DUES_PROOF', jsonb_build_object('status', v_status, 'reason', v_reason, 'semester', v_sem));

  RETURN jsonb_build_object('success', true, 'status', v_status, 'reason', v_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dues_submit_proof(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dues_submit_proof(jsonb) TO authenticated;

-- ── 6. 입부 폼 수신 (Apps Script: anon 키 + 공유 비밀값. ingest_rental_request 와 같은 값 gas_shared_secret) ──
-- payload: { secret, student_id, name, phone, department, track, submitted_at,
--            proof?: { status, reason, amount, account_tail, file_ref, file_hash } }
CREATE OR REPLACE FUNCTION public.ingest_member_application(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_expected text;
  v_sid      text := regexp_replace(coalesce(p_payload->>'student_id', ''), '\D', '', 'g');
  v_at       timestamptz;
  v_sem      text;
  v_proof    jsonb := p_payload->'proof';
  v_status   text;
  v_reason   text;
  v_hash     text;
  v_uid      uuid;
  v_paid     boolean := false;
BEGIN
  SELECT value INTO v_expected FROM public.private_config WHERE key = 'gas_shared_secret';
  IF v_expected IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', '서버 시크릿 미설정');
  END IF;
  IF coalesce(p_payload->>'secret', '') <> v_expected THEN
    RETURN jsonb_build_object('success', false, 'message', '인증 실패');
  END IF;
  IF length(v_sid) < 6 THEN
    RETURN jsonb_build_object('success', false, 'message', '학번 없음');
  END IF;

  BEGIN
    v_at := (p_payload->>'submitted_at')::timestamptz;
  EXCEPTION WHEN others THEN
    v_at := NULL;
  END;
  v_at  := coalesce(v_at, now());
  v_sem := public._dues_semester(v_at);

  INSERT INTO public.member_applications (student_id, name, phone, department, track, semester, submitted_at)
  VALUES (v_sid, nullif(btrim(p_payload->>'name'), ''), nullif(btrim(p_payload->>'phone'), ''),
          nullif(btrim(p_payload->>'department'), ''), nullif(btrim(p_payload->>'track'), ''), v_sem, v_at)
  ON CONFLICT (student_id, semester) DO UPDATE
    SET name = EXCLUDED.name, phone = EXCLUDED.phone, department = EXCLUDED.department,
        track = EXCLUDED.track, submitted_at = EXCLUDED.submitted_at, received_at = now();

  -- 폼에 캡처가 같이 왔으면 같은 판정 결과를 기록한다 (이번 학기 제출분만)
  IF v_proof IS NOT NULL AND jsonb_typeof(v_proof) = 'object' AND v_sem = public._dues_semester() THEN
    v_status := v_proof->>'status';
    v_reason := v_proof->>'reason';
    v_hash   := nullif(v_proof->>'file_hash', '');
    IF v_status IN ('approved', 'pending_review', 'rejected') THEN
      IF v_status = 'approved' AND v_hash IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.dues_proofs WHERE file_hash = v_hash AND status IN ('approved', 'revoked')) THEN
        v_status := 'rejected'; v_reason := 'duplicate';
      END IF;
      SELECT id INTO v_uid FROM public.profiles
       WHERE regexp_replace(student_id, '\D', '', 'g') = v_sid LIMIT 1;
      INSERT INTO public.dues_proofs (user_id, student_id, semester, source, status, reason, amount, account_tail, image_path, file_hash)
      VALUES (v_uid, v_sid, v_sem, 'form', v_status, v_reason,
              nullif(v_proof->>'amount', '')::int, nullif(v_proof->>'account_tail', ''),
              nullif(v_proof->>'file_ref', ''), v_hash);
      IF v_status = 'approved' AND v_uid IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.dues_proofs WHERE user_id = v_uid AND semester = v_sem AND status = 'revoked') THEN
        UPDATE public.profiles SET is_paid = true, last_paid_semester = v_sem WHERE id = v_uid;
        INSERT INTO public.logs (user_id, action_type, details)
        VALUES (v_uid, 'DUES_PROOF', jsonb_build_object('status', 'approved', 'reason', v_reason, 'semester', v_sem, 'source', 'form'));
        v_paid := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'semester', v_sem, 'proof_status', v_status, 'paid', v_paid);
END;
$$;
-- anon 이 부른다 (비밀값 검증). PUBLIC 기본 EXECUTE 를 anon·authenticated 로 좁힌다.
REVOKE EXECUTE ON FUNCTION public.ingest_member_application(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_member_application(jsonb) TO anon, authenticated;

-- ── 7. 관리자 ──
CREATE OR REPLACE FUNCTION public.admin_list_dues_proofs(p_semester text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_sem text := coalesce(p_semester, public._dues_semester());
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  RETURN jsonb_build_object(
    'semester', v_sem,
    'approved_count', (SELECT count(*) FROM public.dues_proofs WHERE semester = v_sem AND status = 'approved'),
    'images_left', (SELECT count(*) FROM public.dues_proofs WHERE semester = v_sem AND source = 'site' AND image_path IS NOT NULL),
    'application_last_received', (SELECT max(received_at) FROM public.member_applications),
    'application_count', (SELECT count(*) FROM public.member_applications WHERE semester = v_sem),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC) FROM (
        SELECT d.id, d.user_id, d.student_id, p.name, d.source, d.status, d.reason, d.amount,
               d.account_tail, d.image_path, d.created_at, d.reviewed_at
          FROM public.dues_proofs d LEFT JOIN public.profiles p ON p.id = d.user_id
         WHERE d.semester = v_sem
      ) r), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_dues_proofs(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_dues_proofs(text) TO authenticated;

-- p_action: approve(허가) / reject(반려) / revoke(허가 되돌리기 — is_paid 를 끈다)
CREATE OR REPLACE FUNCTION public.admin_review_dues_proof(p_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.dues_proofs%ROWTYPE;
  v_new text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  SELECT * INTO v_row FROM public.dues_proofs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', '기록이 없습니다.'); END IF;
  v_new := CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' WHEN 'revoke' THEN 'revoked' END;
  IF v_new IS NULL THEN RETURN jsonb_build_object('success', false, 'message', '알 수 없는 동작'); END IF;

  UPDATE public.dues_proofs SET status = v_new, reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_id;
  IF v_row.user_id IS NOT NULL THEN
    IF v_new = 'approved' THEN
      UPDATE public.profiles SET is_paid = true, last_paid_semester = v_row.semester WHERE id = v_row.user_id;
    ELSIF v_new = 'revoked' THEN
      UPDATE public.profiles SET is_paid = false WHERE id = v_row.user_id;
    END IF;
  END IF;
  INSERT INTO public.logs (user_id, action_type, details)
  VALUES (auth.uid(), 'DUES_PROOF_REVIEW', jsonb_build_object('proof_id', p_id, 'target', v_row.user_id, 'action', p_action));
  RETURN jsonb_build_object('success', true, 'status', v_new);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_review_dues_proof(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_dues_proof(uuid, text) TO authenticated;

-- 학기 종료: 그 학기 사이트 캡처 경로를 비우고, 지울 파일 목록을 돌려준다 (실제 파일은 화면이 보관소 API 로 지운다)
CREATE OR REPLACE FUNCTION public.admin_clear_dues_proof_images(p_semester text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_paths jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  WITH old AS (
    SELECT id, image_path FROM public.dues_proofs
     WHERE semester = p_semester AND source = 'site' AND image_path IS NOT NULL
     FOR UPDATE
  ), cleared AS (
    UPDATE public.dues_proofs SET image_path = NULL WHERE id IN (SELECT id FROM old)
  )
  SELECT coalesce(jsonb_agg(image_path), '[]'::jsonb) INTO v_paths FROM old;
  RETURN jsonb_build_object('success', true, 'paths', v_paths);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_clear_dues_proof_images(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_dues_proof_images(text) TO authenticated;

-- ── 8. 보관소 (비공개). 경로: {semester}/{user_id}/{uuid}.jpg ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('dues-proofs', 'dues-proofs', false, 2097152, ARRAY['image/jpeg', 'image/webp', 'image/png'])
ON CONFLICT (id) DO NOTHING;

-- 부원: 자기 폴더에 올리기만 (읽기·지우기 없음)
DROP POLICY IF EXISTS "dues_proofs_insert_own" ON storage.objects;
CREATE POLICY "dues_proofs_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dues-proofs' AND (storage.foldername(name))[2] = auth.uid()::text);

-- 관리자: 읽기·지우기
DROP POLICY IF EXISTS "dues_proofs_admin_select" ON storage.objects;
CREATE POLICY "dues_proofs_admin_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'dues-proofs' AND public.is_admin());

DROP POLICY IF EXISTS "dues_proofs_admin_delete" ON storage.objects;
CREATE POLICY "dues_proofs_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'dues-proofs' AND public.is_admin());
