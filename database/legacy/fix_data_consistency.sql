-- ========================================
-- 데이터 정합성 종합 정리 함수
-- ========================================
-- 목적: 찜/대여/반납 과정에서 발생한 모든 데이터 불일치 해결
-- 사용법: SELECT fix_rental_data_consistency();

CREATE OR REPLACE FUNCTION public.fix_rental_data_consistency()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_expired_dibs_count INTEGER := 0;
    v_orphan_reserved_count INTEGER := 0;
    v_orphan_rented_count INTEGER := 0;
    v_duplicate_active_count INTEGER := 0;
    v_status_mismatch_count INTEGER := 0;
BEGIN
    -- ========================================
    -- 1. 만료된 찜(DIBS) 정리
    -- ========================================
    -- 30분이 지난 찜을 종료 처리
    UPDATE public.rentals
    SET returned_at = now()
    WHERE type = 'DIBS'
      AND returned_at IS NULL
      AND due_date < now();
    
    GET DIAGNOSTICS v_expired_dibs_count = ROW_COUNT;

    -- ========================================
    -- 2. 고아 RESERVED 상태 복구
    -- ========================================
    -- 활성 찜(rentals)이 없는데 RESERVED 상태인 카피를 AVAILABLE로 변경
    UPDATE public.game_copies
    SET status = 'AVAILABLE'
    WHERE status = 'RESERVED'
      AND copy_id NOT IN (
          SELECT copy_id
          FROM public.rentals
          WHERE type = 'DIBS'
            AND returned_at IS NULL
      );
    
    GET DIAGNOSTICS v_orphan_reserved_count = ROW_COUNT;

    -- ========================================
    -- 3. 고아 RENTED 상태 복구
    -- ========================================
    -- 활성 대여(rentals)가 없는데 RENTED 상태인 카피를 AVAILABLE로 변경
    UPDATE public.game_copies
    SET status = 'AVAILABLE'
    WHERE status = 'RENTED'
      AND copy_id NOT IN (
          SELECT copy_id
          FROM public.rentals
          WHERE type = 'RENT'
            AND returned_at IS NULL
      );
    
    GET DIAGNOSTICS v_orphan_rented_count = ROW_COUNT;

    -- ========================================
    -- 4. 중복 활성 대여 정리
    -- ========================================
    -- 같은 copy_id에 대해 여러 개의 활성 대여가 있는 경우
    -- 가장 최근 것만 남기고 나머지는 종료 처리
    WITH duplicate_rentals AS (
        SELECT 
            rental_id,
            ROW_NUMBER() OVER (
                PARTITION BY copy_id, type 
                ORDER BY borrowed_at DESC
            ) as rn
        FROM public.rentals
        WHERE returned_at IS NULL
    )
    UPDATE public.rentals
    SET returned_at = now()
    WHERE rental_id IN (
        SELECT rental_id 
        FROM duplicate_rentals 
        WHERE rn > 1
    );
    
    GET DIAGNOSTICS v_duplicate_active_count = ROW_COUNT;

    -- ========================================
    -- 5. 상태 불일치 수정
    -- ========================================
    -- rentals에는 활성 찜이 있는데 game_copies가 RESERVED가 아닌 경우
    UPDATE public.game_copies gc
    SET status = 'RESERVED'
    WHERE EXISTS (
        SELECT 1
        FROM public.rentals r
        WHERE r.copy_id = gc.copy_id
          AND r.type = 'DIBS'
          AND r.returned_at IS NULL
          AND r.due_date > now()
    )
    AND gc.status != 'RESERVED';
    
    -- rentals에는 활성 대여가 있는데 game_copies가 RENTED가 아닌 경우
    UPDATE public.game_copies gc
    SET status = 'RENTED'
    WHERE EXISTS (
        SELECT 1
        FROM public.rentals r
        WHERE r.copy_id = gc.copy_id
          AND r.type = 'RENT'
          AND r.returned_at IS NULL
    )
    AND gc.status != 'RENTED';
    
    GET DIAGNOSTICS v_status_mismatch_count = ROW_COUNT;

    -- ========================================
    -- 6. 반납 완료된 대여의 카피 상태 확인
    -- ========================================
    -- 모든 대여가 반납 완료되었는데 RENTED/RESERVED 상태인 카피를 AVAILABLE로 변경
    UPDATE public.game_copies gc
    SET status = 'AVAILABLE'
    WHERE (status = 'RENTED' OR status = 'RESERVED')
      AND NOT EXISTS (
          SELECT 1
          FROM public.rentals r
          WHERE r.copy_id = gc.copy_id
            AND r.returned_at IS NULL
      );

    -- ========================================
    -- 결과 반환
    -- ========================================
    RETURN jsonb_build_object(
        'success', true,
        'message', '데이터 정합성 정리 완료',
        'details', jsonb_build_object(
            'expired_dibs_closed', v_expired_dibs_count,
            'orphan_reserved_fixed', v_orphan_reserved_count,
            'orphan_rented_fixed', v_orphan_rented_count,
            'duplicate_rentals_closed', v_duplicate_active_count,
            'status_mismatches_fixed', v_status_mismatch_count
        )
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'message', '정리 중 오류 발생',
        'error', SQLERRM
    );
END;
$$;

-- ========================================
-- 사용 예시
-- ========================================
-- Supabase SQL Editor 또는 psql에서 실행:
-- SELECT fix_rental_data_consistency();

-- 결과 예시:
-- {
--   "success": true,
--   "message": "데이터 정합성 정리 완료",
--   "details": {
--     "expired_dibs_closed": 5,
--     "orphan_reserved_fixed": 3,
--     "orphan_rented_fixed": 2,
--     "duplicate_rentals_closed": 1,
--     "status_mismatches_fixed": 4
--   }
-- }

-- ========================================
-- 자동 실행 설정 (선택사항)
-- ========================================
-- GitHub Actions에서 주기적으로 실행하거나,
-- Supabase의 pg_cron 확장을 사용하여 자동 실행 가능

-- pg_cron 예시 (매 10분마다 실행):
-- SELECT cron.schedule(
--     'cleanup-rental-data',
--     '*/10 * * * *',
--     'SELECT fix_rental_data_consistency();'
-- );
