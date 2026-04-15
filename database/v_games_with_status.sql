-- [PERFORMANCE] v_games_with_status View
-- 특징: 게임 정보와 활성 대여 정보를 서버사이드에서 Join하여 제공
-- 찜(DIBS) 만료 체크 및 프로필 이름 조인 포함
--
-- [SECURITY] RLS 고려사항:
-- - rentals의 RLS가 적용됨: auth.uid() = user_id OR is_admin()
--   → 일반 사용자는 자신의 대여만, 관리자는 전체 대여 정보 볼 수 있음
-- - profiles의 RLS는 JOIN 시점에 자동으로 적용됨
--   → 각 사용자는 자신의 프로필 정보만 조회 가능
-- - 따라서 뷰를 통해서도 RLS가 정상 작동함 ✅

CREATE OR REPLACE VIEW public.v_games_with_status AS
WITH active_rentals_data AS (
    SELECT
        r.game_id,
        jsonb_agg(
            jsonb_build_object(
                'rental_id', r.rental_id,
                'user_id', r.user_id,
                'renter_name', r.renter_name,
                'type', r.type,
                'due_date', r.due_date,
                'profiles', jsonb_build_object('name', p.name)
            )
        ) AS active_rentals
    FROM public.rentals r
    LEFT JOIN public.profiles p ON r.user_id = p.id
    WHERE r.returned_at IS NULL
      AND (r.type = 'RENT' OR (r.type = 'DIBS' AND r.due_date > now()))
    GROUP BY r.game_id
)
SELECT
    g.*,
    COALESCE(ard.active_rentals, '[]'::jsonb) AS active_rentals_json
FROM public.games g
LEFT JOIN active_rentals_data ard ON g.id = ard.game_id;

-- RLS 정책 설정 (뷰도 RLS 적용)
ALTER VIEW public.v_games_with_status OWNER TO postgres;
GRANT SELECT ON public.v_games_with_status TO anon, authenticated;
