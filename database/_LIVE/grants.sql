-- ================================================================
-- GRANTS — anon / authenticated 실효 권한 (RLS 이전 단계)
-- 프로젝트: hptvqangstiaatdtusrg
-- 생성 시각: 2026. 9. 3. AM 9:45:40
-- 생성 스크립트: scripts/pull_schema.js
-- (자동 생성 파일 — 직접 수정하지 마세요)
-- ================================================================

-- 읽는 법:
--   anon=Y 인 SECURITY DEFINER 함수는 비로그인으로 호출 가능하다. 의도된 것만 남아야 한다.
--   (is_admin/is_kiosk_or_admin 은 정책 평가용으로 anon=Y 가 정상. 회수 금지)
--   테이블 GRANT 는 RLS 정책과 AND 로 작동한다. anon 에게는 쓰기 GRANT 가 없어야 한다.

-- ----------------------------------------------------------------
-- 함수 EXECUTE  (87개)
-- ----------------------------------------------------------------
-- anon  auth  security  function
--  -     -    INVOKER   _active_rentals_json(p_game_id integer, p_uid uuid, p_admin boolean)
--  Y     Y    INVOKER   _event_calc_fee(p_pricing jsonb, p_tier text)
--  Y     Y    INVOKER   _event_generate_invite_code()
--  Y     Y    INVOKER   _event_is_full(p_event_id uuid)
--  Y     Y    INVOKER   _event_make_depositor_name(p_event_slug text, p_name text)
--  -     -    DEFINER   _fuzzy_match_games(raw text)
--  -     -    INVOKER   _parse_duration(raw text)
--  -     -    INVOKER   _parse_fee(raw text)
--  -     -    INVOKER   _parse_game_count(raw text)
--  -     -    INVOKER   _parse_pickup(raw text)
--  Y     Y    INVOKER   _tg_event_set_updated_at()
--  -     Y    DEFINER   add_game_copy(p_game_id integer)
--  -     Y    DEFINER   admin_cancel_dibs(p_game_id integer, p_rental_id uuid, p_user_id uuid)
--  -     Y    DEFINER   admin_extend_rentals(p_user_id uuid, p_renter_name text, p_game_id integer, p_rental_id uuid, p_days integer)
--  -     Y    DEFINER   admin_mark_lost(p_game_id integer, p_rental_id uuid)
--  -     Y    DEFINER   admin_rent_game(p_game_id integer, p_renter_name text, p_user_id uuid, p_rental_id uuid)
--  -     Y    DEFINER   admin_return_game(p_game_id integer, p_renter_name text, p_user_id uuid, p_rental_id uuid)
--  -     Y    DEFINER   admin_update_user_roles(p_user_id uuid, p_role_keys text[])
--  -     Y    DEFINER   cancel_dibs(p_game_id integer, p_user_id uuid)
--  -     -    DEFINER   cleanup_expired_dibs()
--  -     Y    DEFINER   confirm_rental_request(p_request_id uuid, p_game_ids integer[], p_pickup_at timestamp with time zone, p_duration_days integer)
--  Y     Y    INVOKER   count_active_occupancy(p_game_id integer)
--  -     Y    DEFINER   dibs_any_copy(p_game_id integer, p_user_id uuid)
--  -     Y    DEFINER   dibs_game(p_game_id integer, p_user_id uuid)
--  -     -    DEFINER   earn_points(p_user_id uuid, p_amount integer, p_type text, p_reason text)
--  -     Y    DEFINER   event_admin_register(p_event_id uuid, p_user_id uuid, p_membership_tier text, p_team_id uuid, p_mark_paid boolean, p_actual_depositor_name text, p_note text)
--  -     Y    DEFINER   event_cancel_admin(p_registration_id uuid, p_reason text)
--  -     Y    DEFINER   event_cancel_my_registration(p_registration_id uuid, p_reason text)
--  -     Y    DEFINER   event_check_in(p_registration_id uuid)
--  -     Y    DEFINER   event_create_team(p_event_id uuid, p_team_name text, p_size_target integer, p_extra_answers jsonb, p_photo_consent boolean)
--  -     Y    DEFINER   event_expire_unpaid(p_event_id uuid)
--  -     Y    DEFINER   event_invite_user(p_event_id uuid, p_user_id uuid, p_note text)
--  -     Y    DEFINER   event_join_team(p_invite_code text, p_extra_answers jsonb, p_photo_consent boolean)
--  -     Y    DEFINER   event_mark_paid(p_registration_id uuid, p_actual_depositor_name text, p_note text)
--  -     Y    DEFINER   event_promote_waitlist(p_registration_id uuid)
--  -     Y    DEFINER   event_refund(p_registration_id uuid, p_note text)
--  -     Y    DEFINER   event_register_individual(p_event_id uuid, p_extra_answers jsonb, p_photo_consent boolean)
--  -     Y    DEFINER   event_unmark_paid(p_registration_id uuid, p_note text)
--  -     Y    DEFINER   fix_rental_data_consistency()
--  -     Y    DEFINER   get_admin_analytics_activity(p_start_date date, p_end_date date, p_user_id uuid, p_game_id integer, p_action_types text[], p_limit integer)
--  -     Y    DEFINER   get_admin_analytics_rankings(p_start_date date, p_end_date date, p_user_id uuid, p_game_id integer, p_action_types text[], p_limit integer)
--  -     Y    DEFINER   get_admin_analytics_summary(p_start_date date, p_end_date date, p_user_id uuid, p_game_id integer, p_action_types text[])
--  -     Y    DEFINER   get_admin_analytics_timeline(p_start_date date, p_end_date date, p_user_id uuid, p_game_id integer, p_action_types text[])
--  -     Y    DEFINER   get_admin_game_purchase_requests(p_start_date date, p_end_date date, p_user_id uuid, p_game_id integer, p_limit integer)
--  -     Y    DEFINER   get_admin_unavailable_game_views(p_start_date date, p_end_date date, p_user_id uuid, p_game_id integer, p_limit integer)
--  Y     Y    DEFINER   get_game_with_rentals(p_game_id integer)
--  Y     Y    DEFINER   get_games_with_rentals()
--  -     Y    DEFINER   get_my_rental_history()
--  -     Y    DEFINER   get_my_roles()
--  -     Y    DEFINER   get_overdue_stats(p_days integer)
--  -     Y    DEFINER   get_popular_searches(p_limit integer, p_days integer)
--  -     Y    DEFINER   get_rental_source_breakdown(p_days integer)
--  -     Y    DEFINER   get_rental_stats(p_days integer)
--  -     Y    DEFINER   get_top_rented_games(p_limit integer, p_days integer)
--  -     Y    DEFINER   get_trending_games()
--  -     -    DEFINER   handle_new_user()
--  -     Y    DEFINER   increment_view_count(p_game_id integer)
--  Y     Y    DEFINER   ingest_rental_request(p_payload jsonb)
--  Y     Y    DEFINER   is_admin()
--  Y     Y    DEFINER   is_event_team_leader(p_team_id uuid)
--  Y     Y    DEFINER   is_event_team_member(p_team_id uuid)
--  Y     Y    DEFINER   is_kiosk_or_admin()
--  Y     Y    INVOKER   is_payment_check_enabled()
--  Y     Y    INVOKER   is_user_payment_exempt(p_user_id uuid)
--  -     Y    DEFINER   kiosk_list_active_rentals()
--  -     Y    DEFINER   kiosk_list_active_reservations()
--  -     Y    DEFINER   kiosk_list_users()
--  -     Y    DEFINER   kiosk_pickup(p_rental_id uuid)
--  -     Y    DEFINER   kiosk_rental(p_game_id integer, p_user_id uuid)
--  -     Y    DEFINER   kiosk_return(p_game_id integer, p_user_id uuid, p_rental_id uuid)
--  -     -    DEFINER   recalc_all_game_availability()
--  -     -    DEFINER   recalc_game_availability(p_game_id integer)
--  -     Y    DEFINER   register_match_result(p_game_id integer, p_player_ids uuid[], p_winner_ids uuid[])
--  -     Y    DEFINER   reject_rental_request(p_request_id uuid, p_reason text)
--  -     Y    DEFINER   rent_any_copy(p_game_id integer, p_user_id uuid)
--  -     Y    DEFINER   rent_game(p_game_id integer, p_user_id uuid, p_renter_name text)
--  -     -    DEFINER   reset_own_password(p_student_id text, p_name text, p_phone text, p_new_password text)
--  -     Y    DEFINER   reset_semester_payments()
--  -     Y    DEFINER   reset_user_password(target_user_id uuid)
--  -     -    DEFINER   resolve_membership_tier(p_user_id uuid)
--  -     Y    DEFINER   return_game(p_game_id integer, p_user_id uuid)
--  -     Y    DEFINER   safe_delete_game(p_game_id integer)
--  -     Y    DEFINER   send_user_log(p_game_id integer, p_action_type text, p_details jsonb)
--  -     Y    DEFINER   set_private_config(p_key text, p_value text)
--  Y     Y    INVOKER   tg_profiles_guard_columns()
--  -     Y    DEFINER   update_my_semester(new_semester text)
--  -     Y    DEFINER   withdraw_user(p_user_id uuid)

-- ----------------------------------------------------------------
-- 테이블 권한  (39개)
-- ----------------------------------------------------------------
GRANT SELECT ON public.allowed_users TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.allowed_users TO authenticated;
GRANT SELECT ON public.app_config TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.app_config TO authenticated;
GRANT SELECT ON public.damage_reports TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.damage_reports TO authenticated;
GRANT SELECT ON public.event_payment_logs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.event_payment_logs TO authenticated;
GRANT SELECT ON public.event_registrations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.event_registrations TO authenticated;
GRANT SELECT ON public.event_teams TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.event_teams TO authenticated;
GRANT SELECT ON public.events TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.events TO authenticated;
GRANT SELECT ON public.game_daily_stats TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.game_daily_stats TO authenticated;
GRANT SELECT ON public.game_requests TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.game_requests TO authenticated;
GRANT SELECT ON public.games TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.games TO authenticated;
GRANT SELECT ON public.logs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.logs TO authenticated;
GRANT SELECT ON public.matches TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.matches TO authenticated;
GRANT SELECT ON public.point_transactions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.point_transactions TO authenticated;
GRANT SELECT ON public.private_config TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.private_config TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.rental_requests TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rental_requests TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rentals TO authenticated;
GRANT SELECT ON public.reviews TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.reviews TO authenticated;
GRANT SELECT ON public.roles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.roles TO authenticated;
GRANT SELECT ON public.user_roles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_roles TO authenticated;

-- ----------------------------------------------------------------
-- 컬럼 단위 권한 (테이블 권한 없이 컬럼만 열린 것, 1개)
-- ----------------------------------------------------------------
GRANT SELECT (borrowed_at, due_date, game_id, rental_id, returned_at, type) ON public.rentals TO anon;
