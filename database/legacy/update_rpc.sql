-- 1. Game ID로 아무 카피나 빌리는 편의 함수
CREATE OR REPLACE FUNCTION public.rent_any_copy(
    p_game_id integer,
    p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_copy_id integer;
    v_game_name text;
    v_rental_id uuid;
BEGIN
    -- 1. 해당 게임의 'AVAILABLE' 상태인 카피 하나를 찾습니다 (비관적 락)
    SELECT copy_id INTO v_copy_id
    FROM public.game_copies
    WHERE game_id = p_game_id AND status = 'AVAILABLE'
    LIMIT 1
    FOR UPDATE SKIP LOCKED; -- 대기하지 않고 다른 트랜잭션이 잡고 있으면 건너뜀 (없으면 null)

    IF v_copy_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 가능한 재고가 없습니다.');
    END IF;

    -- 2. 게임 이름 조회
    SELECT name INTO v_game_name FROM public.games WHERE id = p_game_id;

    -- 3. 기존의 rent_game 로직 수행 (여기서 바로 복붙하거나 호출)
    -- 하지만 rent_game 함수가 copy_id, name, due_date를 요구하므로 맞춰줍니다.
    -- 30분 뒤 반납 예정이 기본 (기존 로직 준수)
    
    INSERT INTO public.rentals (user_id, copy_id, game_name, borrowed_at, due_date)
    VALUES (p_user_id, v_copy_id, v_game_name, now(), now() + interval '30 minutes')
    RETURNING rental_id INTO v_rental_id;

    -- 4. 카피 상태 변경
    UPDATE public.game_copies
    SET status = 'RENTED'
    WHERE copy_id = v_copy_id;

    -- 5. 로그 기록
    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (p_game_id, p_user_id, 'RENT', jsonb_build_object('copy_id', v_copy_id));

    RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 리뷰 작성 정책 (로그인한 유저만)
CREATE POLICY "Enable insert for authenticated users only" 
ON public.reviews FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- 3. 리뷰 삭제 정책 (본인만)
CREATE POLICY "Enable delete for users based on user_id" 
ON public.reviews FOR DELETE 
USING (auth.uid() = user_id);
