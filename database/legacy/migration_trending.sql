-- 1. 일별 통계 테이블 생성
CREATE TABLE IF NOT EXISTS public.game_daily_stats (
    id bigint generated always as identity primary key,
    game_id integer not null references public.games(id) on delete cascade,
    date date not null default current_date,
    view_count integer default 1,
    unique(game_id, date) -- 게임+날짜 조합은 유일해야 함 (UPSERT용)
);

-- 2. 통계 증가 RPC (Atomic Increment)
-- 기존 increment_view_count 대체
CREATE OR REPLACE FUNCTION public.increment_view_count(p_game_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- 1. Games 테이블 총 조회수 증가 (기본 데이터)
    UPDATE public.games
    SET total_views = total_views + 1
    WHERE id = p_game_id;

    -- 2. 일별 통계 테이블 UPSERT (Efficient Logging)
    INSERT INTO public.game_daily_stats (game_id, date, view_count)
    VALUES (p_game_id, current_date, 1)
    ON CONFLICT (game_id, date)
    DO UPDATE SET view_count = game_daily_stats.view_count + 1;
END;
$$;

-- 3. 트렌드 조회 RPC (최근 7일 기준)
CREATE OR REPLACE FUNCTION public.get_trending_games()
RETURNS TABLE (
    id integer,
    name text,
    image text,
    category text,
    weekly_views bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        g.id,
        g.name,
        g.image,
        g.category,
        SUM(s.view_count)::bigint as weekly_views
    FROM public.game_daily_stats s
    JOIN public.games g ON s.game_id = g.id
    WHERE s.date >= (current_date - interval '7 days')
    GROUP BY g.id, g.name, g.image, g.category
    ORDER BY weekly_views DESC
    LIMIT 5;
END;
$$;
