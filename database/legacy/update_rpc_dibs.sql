-- update_rentals_schema.sql

-- 1. Rentals 테이블에 'type' 컬럼 추가 (기본값: RENT)
ALTER TABLE public.rentals 
ADD COLUMN IF NOT EXISTS type text DEFAULT 'RENT';

-- 2. 기존 데이터 마이그레이션 (이미 있는 건 다 RENT로 간주)
UPDATE public.rentals SET type = 'RENT' WHERE type IS NULL;

-- 3. Dibs(찜) 함수 생성 (30분 유효)
CREATE OR REPLACE FUNCTION public.dibs_any_copy(
    p_game_id integer,
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_copy_id integer;
    v_game_name text;
    v_rental_id uuid;
BEGIN
    -- 1. Game Name 가져오기
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;

    -- 2. Available Copy 하나 잡기 (Lock)
    SELECT copy_id INTO v_copy_id
    FROM public.game_copies
    WHERE game_id = p_game_id AND status = 'AVAILABLE'
    LIMIT 1
    FOR UPDATE SKIP LOCKED; -- 동시성 제어

    IF v_copy_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 가능한 재고가 없습니다.');
    END IF;

    -- 3. 상태 변경 (RESERVED)
    UPDATE public.game_copies
    SET status = 'RESERVED'
    WHERE copy_id = v_copy_id;

    -- 4. Rentals 기록 (Type='DIBS', 30분 후 만료)
    INSERT INTO public.rentals (user_id, copy_id, game_name, borrowed_at, due_date, type)
    VALUES (
        p_user_id, 
        v_copy_id, 
        v_game_name, 
        now(), 
        now() + interval '30 minutes',
        'DIBS'
    )
    RETURNING rental_id INTO v_rental_id;

    -- 5. 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'DIBS', jsonb_build_object('copy_id', v_copy_id));

    RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Rent(대여확정) 함수 업데이트 (다음날 밤 11:59까지)
CREATE OR REPLACE FUNCTION public.rent_any_copy(
    p_game_id integer,
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_copy_id integer;
    v_game_name text;
    v_rental_id uuid;
    v_due_date timestamptz;
BEGIN
    -- 1. Game Name
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;

    -- 2. 마감기한 계산: (내일) + 23:59:59
    -- Logic: (current_date + 1) + time '23:59:59'
    v_due_date := (current_date + 1) + time '23:59:59';
    -- Timezone 이슈가 있을 수 있으니, 한국시간 기준 명시가 좋지만 일단 UTC/ServerTime 기준 자정으로 감.
    -- Supabase는 UTC 기준일 수 있음. 
    -- 안전하게: 지금 시각 기준으로 +1일 하고, 시간을 23:59:59로 셋팅하는 로직은 SQL에서 복잡할 수 있음.
    -- 대안: interval '1 day' + fixed time? 
    -- 심플 구현: 현재 시각 + 24시간? 아니면 유저 요구사항 "다음날 저녁 12시" -> "내일 자정"
    
    -- [Fix] 다음날 끝까지 (내일 23:59:59)
    -- current_date는 UTC 00:00. 한국시간 고려하면 +9시간 필요할 수도 있음.
    -- 일단 서버 기준 '내일 23:59:59'로 설정.
    v_due_date := (current_date + 1) + time '23:59:59';

    -- 3. Copy 찾기 (RESERVED 된 것이 본인 것인지 확인하는 로직은 복잡하므로, 
    --    일단 AVAILABLE이거나, 본인이 찜한 RESERVED를 찾는다? 
    --    -> Admin이 처리하는 경우 보통 CopyID를 찍어서 처리함.
    --    -> 하지만 이 함수는 `rent_any_copy` (유저용 혹은 키오스크용).
    --    -> 여기서는 "찜한걸 대여 전환"이 아니라 "새로 대여" 로직 유지.
    --    -> 찜->대여 전환 별도 함수 필요? 아니면 여기서 통합?
    
    --    [통합 로직]
    --    1) 본인이 찜한 Copy가 있으면 그걸 대여로 전환.
    --    2) 없으면 Available 찾아서 대여.

    -- 3-1. 본인 찜 확인
    SELECT copy_id INTO v_copy_id
    FROM public.rentals
    WHERE user_id = p_user_id 
      AND type = 'DIBS' 
      AND returned_at IS NULL
      AND copy_id IN (SELECT copy_id FROM public.game_copies WHERE game_id = p_game_id)
    LIMIT 1;

    IF v_copy_id IS NOT NULL THEN
        -- 찜한거 대여로 전환 (Update existing rental? No, close Dibs and create Rent? Or Update Type?)
        -- 기록 분리를 위해: Dibs는 완료처리(returned_at=now), Rent 새로 생성?
        -- 아니면 Type만 변경? -> History 관점에서 Type 변경이 깔끔함 (하나의 트랜잭션).
        -- 유저 요구사항: "찜과 대여 기한이 따로 동작" -> 이력이 남길 원함?
        -- 가장 깔끔한 건: 찜(DIBS) 레코드는 그대로 두고(Log성격), 
        -- 재고(copy) 상태를 RENTED로 바꾸고, RENT 레코드를 새로 파는 게 맞음.
        
        -- A. 기존 찜 만료처리
        UPDATE public.rentals SET returned_at = now() WHERE copy_id = v_copy_id AND type = 'DIBS';
        
        -- B. 재고 상태 AVAILABLE로 잠시 인식 (아래 로직 태우기 위해) or 바로 RENTED 업데이트
        UPDATE public.game_copies SET status = 'RENTED' WHERE copy_id = v_copy_id;

    ELSE
        -- 3-2. 찜한게 없으면 새거 찾기
        SELECT copy_id INTO v_copy_id
        FROM public.game_copies
        WHERE game_id = p_game_id AND status = 'AVAILABLE'
        LIMIT 1
        FOR UPDATE SKIP LOCKED;

        IF v_copy_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '대여 가능한 재고가 없습니다.');
        END IF;

        UPDATE public.game_copies SET status = 'RENTED' WHERE copy_id = v_copy_id;
    END IF;

    -- 4. Rentals 기록 (Type='RENT')
    INSERT INTO public.rentals (user_id, copy_id, game_name, borrowed_at, due_date, type)
    VALUES (
        p_user_id, 
        v_copy_id, 
        v_game_name, 
        now(), 
        v_due_date,
        'RENT'
    )
    RETURNING rental_id INTO v_rental_id;

    -- 5. 로그
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('copy_id', v_copy_id));

    RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
