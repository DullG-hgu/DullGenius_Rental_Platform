-- ================================================================
-- MIGRATION: anon_surface_hardening
-- 날짜: 2026-09-02
-- 목적: 비회원(anon)이 접근할 수 있는 면을 "실제로 화면에 필요한 것"으로 줄인다.
--
-- 1) anon 쓰기 권한 전면 회수
--    Supabase 기본값은 anon에게 모든 테이블 INSERT/UPDATE/DELETE를 주고 RLS로만 막는다.
--    RLS를 실수로 끄거나 TO public 쓰기 정책을 하나 추가하면 그대로 뚫린다.
--    비회원이 쓰는 경로(로그·폼 자동화·가입 트리거)는 전부 SECURITY DEFINER RPC라 영향 없음.
--
-- 2) rentals 컬럼 제한
--    비회원 화면은 상태·잔여 수량·반납 예정일만 쓴다. user_id/renter_name/note 등은
--    anon SELECT 대상에서 제외한다. RLS는 행 단위라 컬럼을 못 가리므로 컬럼 GRANT를 쓴다.
--
-- 3) 홈 목록 RPC를 SECURITY DEFINER + 마스킹으로 전환
--    get_games_with_rentals: user_id는 본인 행만, renter_name·회원 이름은 관리자만.
--    get_game_with_rentals(p_game_id): 상세 화면용 단건 (기존 rentals 직접 조회 대체).
--
-- 4) 정책 역할 명시
--    TO public → 공개 조회는 TO anon, authenticated / 본인 조건이 있는 것은 TO authenticated.
--    보안 효과보다는 `grep 'TO anon'` 만으로 비회원 노출 면을 한눈에 보기 위함.
-- ================================================================

-- ---------------------------------------------------------------
-- 1) anon 쓰기 권한 회수
-- ---------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;

-- ---------------------------------------------------------------
-- 2) rentals: anon은 지정 컬럼만 SELECT
-- ---------------------------------------------------------------
REVOKE SELECT ON public.rentals FROM anon;
GRANT SELECT (rental_id, game_id, type, returned_at, due_date, borrowed_at)
  ON public.rentals TO anon;

-- ---------------------------------------------------------------
-- 3) 홈 목록·상세 RPC (SECURITY DEFINER + 마스킹)
-- ---------------------------------------------------------------

-- 내부 헬퍼: 한 게임의 활성 대여 목록을 호출자 권한에 맞게 마스킹해 jsonb로 만든다.
-- 외부에서 직접 호출 금지 (EXECUTE 회수). DEFINER 함수 안에서만 쓴다.
CREATE OR REPLACE FUNCTION public._active_rentals_json(p_game_id integer, p_uid uuid, p_admin boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'rental_id',   r.rental_id,
          'game_id',     r.game_id,
          'user_id',     CASE WHEN p_admin OR r.user_id = p_uid THEN r.user_id END,
          'renter_name', CASE WHEN p_admin OR r.user_id = p_uid THEN r.renter_name END,
          'type',        r.type,
          'returned_at', r.returned_at,
          'due_date',    r.due_date,
          'borrowed_at', r.borrowed_at,
          'profiles',    CASE WHEN (p_admin OR r.user_id = p_uid) AND p.id IS NOT NULL
                              THEN jsonb_build_object('name', p.name) END
        )
        ORDER BY r.borrowed_at
      )
      FROM public.rentals r
      LEFT JOIN public.profiles p
        ON (p_admin OR r.user_id = p_uid) AND p.id = r.user_id
      WHERE r.game_id = p_game_id
        AND r.returned_at IS NULL
    ),
    '[]'::jsonb
  );
$function$;

REVOKE ALL ON FUNCTION public._active_rentals_json(integer, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._active_rentals_json(integer, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public._active_rentals_json(integer, uuid, boolean) FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_games_with_rentals()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_uid   uuid    := auth.uid();
    v_admin boolean := public.is_admin();
BEGIN
    RETURN QUERY
    SELECT to_jsonb(g.*)
        || jsonb_build_object('rentals', public._active_rentals_json(g.id, v_uid, v_admin))
    FROM public.games g
    ORDER BY g.name;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_games_with_rentals() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_game_with_rentals(p_game_id integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_uid   uuid    := auth.uid();
    v_admin boolean := public.is_admin();
    v_row   jsonb;
BEGIN
    SELECT to_jsonb(g.*)
        || jsonb_build_object('rentals', public._active_rentals_json(g.id, v_uid, v_admin))
    INTO v_row
    FROM public.games g
    WHERE g.id = p_game_id;

    RETURN v_row;  -- 없는 게임이면 NULL
END;
$function$;

REVOKE ALL ON FUNCTION public.get_game_with_rentals(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_game_with_rentals(integer) TO anon, authenticated;

-- ---------------------------------------------------------------
-- 4) 정책 역할 명시 (TO public 제거)
-- ---------------------------------------------------------------
-- 공개 조회
ALTER POLICY "Allow public read access"   ON public.app_config        TO anon, authenticated;
ALTER POLICY "events_public_read"         ON public.events            TO anon, authenticated;
ALTER POLICY "Public Read Stats"          ON public.game_daily_stats  TO anon, authenticated;
ALTER POLICY "Allow public read access"   ON public.games             TO anon, authenticated;
ALTER POLICY "Public view active rentals" ON public.rentals           TO anon, authenticated;
ALTER POLICY "Public Read"                ON public.reviews           TO anon, authenticated;
ALTER POLICY "Public Read"                ON public.roles             TO anon, authenticated;

-- 본인 조건 (auth.uid()) — anon에겐 의미 없음
ALTER POLICY "User Create Report"   ON public.damage_reports     TO authenticated;
ALTER POLICY "User View Own Report" ON public.damage_reports     TO authenticated;
ALTER POLICY "User Create Request"  ON public.game_requests      TO authenticated;
ALTER POLICY "User View Own Request" ON public.game_requests     TO authenticated;
ALTER POLICY "View Own Points"      ON public.point_transactions TO authenticated;
ALTER POLICY "Read Own Profile"     ON public.profiles           TO authenticated;
ALTER POLICY "Update Own Profile"   ON public.profiles           TO authenticated;
ALTER POLICY "Manage Own Reviews"   ON public.reviews            TO authenticated;
ALTER POLICY "Read Own Roles"       ON public.user_roles         TO authenticated;

-- private_config "Deny All" (USING false) 은 모든 역할에 false 이므로 그대로 둔다.
