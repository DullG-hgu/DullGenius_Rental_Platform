-- enforce_single_rental.sql

-- [Dibs Enforcement]
CREATE OR REPLACE FUNCTION public.dibs_any_copy(
    p_game_id integer,
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_copy_id integer;
    v_game_name text;
    v_rental_id uuid;
    v_existing_count integer;
BEGIN
    -- 0. [NEW] 중복 대여 확인 (DB Level Enforcement)
    -- 해당 유저가 이 게임(game_id)의 사본을 이미 빌리고 있는지(반납 안 된 상태) 확인
    SELECT count(*) INTO v_existing_count
    FROM public.rentals r
    JOIN public.game_copies gc ON r.copy_id = gc.copy_id
    WHERE r.user_id = p_user_id
      AND gc.game_id = p_game_id
      AND r.returned_at IS NULL;

    IF v_existing_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 이용 중인 게임입니다. (1인 1카피)');
    END IF;

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


-- [Rent Enforcement] (키오스크나 관리자 페이지에서도 동일 규칙 적용 시)
CREATE OR REPLACE FUNCTION public.rent_any_copy(
    p_game_id integer,
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_copy_id integer;
    v_game_name text;
    v_rental_id uuid;
    v_due_date timestamptz;
    v_existing_count integer;
BEGIN
    -- 0. [NEW] 중복 대여 확인 (단, 찜 -> 대여 전환인 경우는 제외해야 함)
    -- 경우의 수:
    -- A. 찜한 상태에서 '대여'버튼 누름 -> 기존 찜을 닫고 대여를 여는 로직이 이 함수 안에 있다면 OK.
    -- B. 그냥 쌩으로 대여 -> 막아야 함.
    
    -- 이 함수(rent_any_copy)의 기존 로직을 보면:
    -- "본인 찜 확인" 로직이 있음 (3-1). 
    -- 찜이 있으면 그걸 대여로 전환하므로 count check에서 걸리면 안됨.
    
    -- 따라서: "본인이 찜한거(DIBS)"는 제외하고 카운트해야 함.
    -- 즉, "RENT" 상태인게 있거나, "DIBS"인데 지금 처리하려는거 말고 다른 카피인 경우... 복잡함.
    
    -- 심플 조건: "이 게임에 대해 반납 안 된 RENT 기록이 있으면 막는다". check DIBS는 아래 로직에서 처리.
    
    SELECT count(*) INTO v_existing_count
    FROM public.rentals r
    JOIN public.game_copies gc ON r.copy_id = gc.copy_id
    WHERE r.user_id = p_user_id
      AND gc.game_id = p_game_id
      AND r.returned_at IS NULL
      AND r.type = 'RENT'; -- 이미 '대여' 중인게 있으면 막음. (찜은 전환 가능하므로 패스)

    IF v_existing_count > 0 THEN
         RETURN jsonb_build_object('success', false, 'message', '이미 대여 중인 게임입니다.');
    END IF;

    -- 1. Game Name
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;

    -- 2. 마감기한
    v_due_date := (current_date + 1) + time '23:59:59';

    -- 3-1. 본인 찜 확인
    SELECT copy_id INTO v_copy_id
    FROM public.rentals
    WHERE user_id = p_user_id 
      AND type = 'DIBS' 
      AND returned_at IS NULL
      AND copy_id IN (SELECT copy_id FROM public.game_copies WHERE game_id = p_game_id)
    LIMIT 1;

    IF v_copy_id IS NOT NULL THEN
        -- 찜 -> 대여 전환
        UPDATE public.rentals SET returned_at = now() WHERE copy_id = v_copy_id AND type = 'DIBS';
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
