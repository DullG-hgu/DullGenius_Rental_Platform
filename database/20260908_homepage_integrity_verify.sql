-- Read-only verification, before or after the separately approved migration.
-- Aggregate results only: no user identifiers, contact details, or record payloads.
SELECT current_setting('TimeZone') AS session_timezone;

SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'point_transactions' AND column_name = 'created_at')
    OR (table_name = 'matches' AND column_name = 'played_at'));

SELECT p.proname, p.prosecdef AS security_definer, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_trending_games', 'kiosk_return', 'earn_points', 'is_admin', 'is_kiosk_or_admin');

SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.rentals'::regclass
  AND tgname = 'guard_rental_return_chronology';

SELECT count(*) FILTER (WHERE returned_at < borrowed_at) AS reversed_return_times,
       count(*) FILTER (WHERE returned_at IS NOT NULL AND borrowed_at IS NULL) AS missing_borrow_times,
       count(*) FILTER (WHERE returned_at IS NULL AND borrowed_at > now()) AS future_active_borrow_times
FROM public.rentals WHERE type = 'RENT';

-- New audit logs explicitly correlate the reward with a rental. Historic logs
-- may lack rental_id, so this must not be used to infer past reward corrections.
SELECT count(*) AS logged_returns,
       count(*) FILTER (WHERE (details->>'points_awarded')::integer > 0
          AND (details->>'returned_at')::timestamptz > r.due_date) AS rewarded_overdue_returns
FROM public.logs l
JOIN public.rentals r ON r.rental_id::text = l.details->>'rental_id'
WHERE l.action_type = 'RETURN' AND l.details->>'action' = 'Kiosk Return'
  AND l.details ? 'points_awarded';
