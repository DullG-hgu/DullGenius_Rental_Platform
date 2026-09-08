-- Pending: apply only after explicit approval for production DB changes.
BEGIN;

-- This function returns only public game fields and aggregate views (no user data).
-- Preserve its ranking contract and all existing table/write restrictions.
REVOKE EXECUTE ON FUNCTION public.get_trending_games() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trending_games() TO anon, authenticated;

-- timestamptz stores an instant; converting to a KST wall clock before assignment
-- in the UTC database added nine hours. Existing rows need separate evidence.
ALTER TABLE public.point_transactions ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.matches ALTER COLUMN played_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.kiosk_return(
    p_game_id integer, p_user_id uuid, p_rental_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_rental public.rentals%ROWTYPE;
    v_returned_at timestamptz;
    v_points integer := 0;
BEGIN
    IF NOT public.is_kiosk_or_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 필요합니다.');
    END IF;

    -- Retain the RPC signature for deployed clients, but never infer a target
    -- from a user/game pair: a retry could otherwise return a different rental.
    IF p_rental_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '반납할 대여 건을 선택해주세요.');
    END IF;

    -- Match the games -> rentals lock order used by rental/pickup RPCs.
    PERFORM 1 FROM public.games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 게임입니다.');
    END IF;

    SELECT * INTO v_rental FROM public.rentals
    WHERE rental_id = p_rental_id AND game_id = p_game_id FOR UPDATE;

    IF NOT FOUND OR v_rental.type IS DISTINCT FROM 'RENT' THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 기록이 없습니다.');
    END IF;
    IF v_rental.returned_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 반납 처리된 건입니다.', 'points_awarded', 0);
    END IF;

    -- Capture the actual completion time after waiting for the locks.
    v_returned_at := clock_timestamp();
    IF v_rental.borrowed_at IS NULL OR v_rental.borrowed_at > v_returned_at THEN
        RETURN jsonb_build_object('success', false, 'message', '대여 시각을 확인해야 합니다. 관리자에게 문의해주세요.');
    END IF;

    UPDATE public.rentals SET returned_at = v_returned_at
    WHERE rental_id = v_rental.rental_id;
    PERFORM public.recalc_game_availability(v_rental.game_id);

    -- The locked row determines both recipient and deadline, never p_user_id.
    IF v_rental.user_id IS NOT NULL AND v_returned_at <= v_rental.due_date THEN
        v_points := 50;
        PERFORM public.earn_points(v_rental.user_id, v_points, 'RETURN_ON_TIME', '제때 반납 보상');
    END IF;

    INSERT INTO public.logs (game_id, user_id, action_type, details)
    VALUES (v_rental.game_id, v_rental.user_id, 'RETURN',
        jsonb_build_object('action', 'Kiosk Return', 'rental_id', v_rental.rental_id,
            'returned_at', v_returned_at, 'points_awarded', v_points));

    RETURN jsonb_build_object('success', true, 'points_awarded', v_points);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kiosk_return(integer, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kiosk_return(integer, uuid, uuid) TO authenticated;

-- Existing anomalies remain available for evidence-based correction. An UPDATE
-- that only anonymizes the borrower (e.g. account withdrawal) must still work.
CREATE OR REPLACE FUNCTION public.guard_rental_return_chronology()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.type IS NOT DISTINCT FROM OLD.type
           AND NEW.borrowed_at IS NOT DISTINCT FROM OLD.borrowed_at
           AND NEW.returned_at IS NOT DISTINCT FROM OLD.returned_at THEN
            RETURN NEW;
        END IF;
    END IF;

    -- An open RENT may have no return time. A closed RENT requires a known
    -- borrowing time and a return at or after it. DIBS/HOLD are not returns.
    IF NEW.type = 'RENT' AND NEW.returned_at IS NOT NULL
       AND (NEW.borrowed_at IS NULL OR NEW.returned_at < NEW.borrowed_at) THEN
        RAISE EXCEPTION '반납 시각은 대여 시각보다 빠를 수 없으며 대여 시각이 필요합니다.'
            USING ERRCODE = '23514', CONSTRAINT = 'rental_return_chronology';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_rental_return_chronology() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_rental_return_chronology ON public.rentals;
CREATE TRIGGER guard_rental_return_chronology
BEFORE INSERT OR UPDATE OF type, borrowed_at, returned_at ON public.rentals
FOR EACH ROW EXECUTE FUNCTION public.guard_rental_return_chronology();

COMMIT;
