-- ============================================================
-- [긴급] 구버전 오버로드 정리 및 누락된 현재 버전 재배포
-- 작성일: 2026-03-01
-- 배경:
--   final_rpc_v2.sql의 DROP+CREATE가 일부 미적용되어
--   kiosk_return의 현재 버전(integer, uuid, uuid)이 DB에 없음.
--   → rental_id를 넘기는 다중 카피 반납 케이스에서 런타임 오류 발생 중.
-- ============================================================
-- 실행 순서: 이 파일을 Supabase SQL Editor에 전체 붙여넣고 실행
-- ============================================================


-- ============================================================
-- 1. kiosk_return — 구버전 오버로드 제거 + 현재 버전 재배포
--    프론트엔드 호출: kiosk_return(p_game_id, p_user_id, p_rental_id)
--    현재 DB: (integer, uuid) / (integer, uuid, boolean) / (integer, uuid, boolean, uuid)
--    필요한 버전: (integer, uuid, uuid DEFAULT NULL)  ← 없음!
-- ============================================================

-- 구버전 전부 제거
DROP FUNCTION IF EXISTS public.kiosk_return(INTEGER, UUID);
DROP FUNCTION IF EXISTS public.kiosk_return(INTEGER, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.kiosk_return(INTEGER, UUID, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS public.kiosk_return(INTEGER, UUID, UUID);

-- 현재 버전 재배포 (final_rpc_v2.sql 기준)
CREATE OR REPLACE FUNCTION public.kiosk_return(
    p_game_id  INTEGER,
    p_user_id  UUID,
    p_rental_id UUID DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE v_rental_id UUID; v_game_name TEXT;
BEGIN
    IF p_rental_id IS NOT NULL THEN
        SELECT rental_id, game_name INTO v_rental_id, v_game_name
        FROM public.rentals
        WHERE rental_id = p_rental_id AND returned_at IS NULL;
    ELSE
        SELECT rental_id, game_name INTO v_rental_id, v_game_name
        FROM public.rentals
        WHERE game_id = p_game_id AND user_id = p_user_id
          AND returned_at IS NULL AND type = 'RENT'
        LIMIT 1;
    END IF;

    IF v_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 기록이 없습니다.');
    END IF;

    UPDATE public.rentals SET returned_at = now() WHERE rental_id = v_rental_id;
    UPDATE public.games SET available_count = available_count + 1 WHERE id = p_game_id;
    PERFORM public.earn_points(p_user_id, 100, 'RETURN_REWARD', '키오스크 반납: ' || v_game_name);
    INSERT INTO public.logs (game_id, user_id, action_type, details)
        VALUES (p_game_id, p_user_id, 'RETURN', to_jsonb('Kiosk Return'::text));
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 2. rent_game — 구버전 copy 기반 오버로드 제거
--    현재 버전 (integer, uuid, text) 는 정상 존재하므로 유지
-- ============================================================

DROP FUNCTION IF EXISTS public.rent_game(INTEGER, UUID, TEXT, TIMESTAMPTZ);


-- ============================================================
-- 3. register_match_result — 구버전 단수 winner 오버로드 제거
--    현재 버전 (integer, uuid[], uuid[]) 는 정상 존재하므로 유지
-- ============================================================

DROP FUNCTION IF EXISTS public.register_match_result(INTEGER, UUID[], UUID);


-- ============================================================
-- 4. 결과 확인 — 각 함수별 오버로드 수가 1개여야 정상
-- ============================================================

SELECT
    proname    AS 함수명,
    pg_get_function_identity_arguments(oid) AS 파라미터,
    CASE prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS 보안모드
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prokind = 'f'
  AND proname IN ('kiosk_return', 'rent_game', 'register_match_result')
ORDER BY proname, 파라미터;
