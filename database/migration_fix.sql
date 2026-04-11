-- [Migration Fix] ID Mismatch 해결을 위한 Raw 테이블 및 통합 마이그레이션

-- 1. 임시 저장소 (Staging Tables) 생성
-- FK 제약 조건 없이 CSV를 받아줄 테이블입니다.

CREATE TABLE public.raw_reviews (
    game_id integer,
    author_name text,
    rating integer,
    content text,
    created_at timestamptz
);

CREATE TABLE public.raw_rentals (
    game_id integer,
    user_id text,
    borrowed_at timestamptz,
    status text
);

-- 2. 통합 마이그레이션 함수
-- raw_games와 raw_reviews/rentals를 연결해서 진짜 테이블로 넣어줍니다.
CREATE OR REPLACE FUNCTION public.migrate_full_data() RETURNS void AS $$
BEGIN
    -- [Step 1] 게임 & 카피 마이그레이션 (기존 migrate_games 로직 포함)
    PERFORM public.migrate_games();

    -- [Step 2] 리뷰 데이터 이동 (Old ID -> Name -> New ID)
    INSERT INTO public.reviews (game_id, author_name, rating, content, created_at)
    SELECT DISTINCT
        g.id,              -- 진짜 Game ID (games 테이블)
        rr.author_name,
        rr.rating,
        rr.content,
        rr.created_at
    FROM public.raw_reviews rr
    JOIN public.raw_games rg ON rr.game_id = rg.id  -- CSV ID로 원본 게임 정보 찾기
    JOIN public.games g ON g.name = rg.name;        -- 이름으로 새 ID 찾기

    -- [Step 3] 렌탈 히스토리 이동
    -- 주의: 과거 이력이므로 user_id(UUID) 매핑이 어려울 수 있음. 
    -- user_id가 'UUID' 형식이면 바로 넣고, 아니면 NULL 처리하거나 raw값 보존이 필요할 수 있음.
    -- 여기서는 allowed_users(명부)에 있는 학번이면 profiles를 찾아 연결 시도.
    
    INSERT INTO public.rentals (copy_id, user_id, game_name, borrowed_at, due_date, returned_at)
    SELECT DISTINCT
        gc.copy_id,        -- 임의의 Copy ID (해당 게임의 아무거나 하나)
        p.id,              -- 프로필 ID (있으면)
        g.name,            -- 스냅샷 이름
        rrent.borrowed_at,
        rrent.borrowed_at + interval '7 days', -- due_date 없으면 +7일 가정
        CASE WHEN rrent.status = 'RETURNED' THEN rrent.borrowed_at + interval '1 day' ELSE NULL END -- 반납일 임시 처리
    FROM public.raw_rentals rrent
    JOIN public.raw_games rg ON rrent.game_id = rg.id
    JOIN public.games g ON g.name = rg.name
    LEFT JOIN public.game_copies gc ON gc.game_id = g.id -- 복사본 중 하나 연결 (정확히 어떤 카피였는지는 추적 불가하므로 1:N 중 아무거나)
    LEFT JOIN public.allowed_users au ON au.student_id = rrent.user_id -- 학번으로 유저 찾기 (CSV user_id 가 학번이라 가정)
    LEFT JOIN public.profiles p ON p.student_id = au.student_id;
    
END;
$$ LANGUAGE plpgsql;
