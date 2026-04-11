-- [Quality Improved] 유저 활동 및 인벤토리 분석을 위한 고성능 로그 시스템
-- 1. 기존 logs 테이블의 details 컬럼을 TEXT에서 JSONB로 변환 (기존 데이터 보존)
DO $$
BEGIN
    -- 컬럼 타입 확인 후 변경 (이미 jsonb면 무시)
    IF (SELECT data_type FROM information_schema.columns 
        WHERE table_name = 'logs' AND column_name = 'details') = 'text' THEN
        
        ALTER TABLE public.logs 
        ALTER COLUMN details TYPE JSONB 
        USING (
            CASE 
                WHEN details IS NULL THEN NULL 
                WHEN details ~ '^{.*}$|^\[.*\]$' THEN details::jsonb 
                ELSE to_jsonb(details) 
            END
        );
    END IF;
END $$;

-- 2. JSONB 기반의 고성능 로그 전송 RPC 생성
CREATE OR REPLACE FUNCTION public.send_user_log(
    p_game_id INTEGER DEFAULT NULL,
    p_action_type TEXT DEFAULT 'ACTION',
    p_details JSONB DEFAULT NULL  -- [CHANGE] TEXT -> JSONB
) RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- 현재 인증된 유저의 ID 가져오기
    v_user_id := auth.uid();

    -- logs 테이블에 기록
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, v_user_id, p_action_type, p_details);

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 권한 설정
GRANT EXECUTE ON FUNCTION public.send_user_log(INTEGER, TEXT, JSONB) TO public;
GRANT EXECUTE ON FUNCTION public.send_user_log(INTEGER, TEXT, JSONB) TO authenticated;
 GRANT EXECUTE ON FUNCTION public.send_user_log(INTEGER, TEXT, JSONB) TO anon;

-- [TIP] 이제 아래와 같이 쿼리하여 유연하게 통계를 낼 수 있습니다:
-- SELECT details->>'query' as search_query, count(*) FROM logs WHERE action_type = 'SEARCH' GROUP BY 1;
