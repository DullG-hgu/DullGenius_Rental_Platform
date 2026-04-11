-- [Fix] 키오스크(Anon)에서 예약 목록 접근 권한 부여 (V2)

-- 1. Rentals 테이블 읽기 허용
-- 키오스크가 전체 예약 현황을 조회하려면 SELECT 권한이 필요합니다.
ALTER TABLE rentals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'rentals' AND policyname = 'Rentals viewable by everyone'
    ) THEN
        CREATE POLICY "Rentals viewable by everyone" 
        ON rentals FOR SELECT 
        USING (true);
    END IF;
END
$$;

-- 2. Games 테이블 읽기 허용 (game_copies 삭제됨)
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'games' AND policyname = 'Games viewable by everyone'
    ) THEN
        CREATE POLICY "Games viewable by everyone" 
        ON games FOR SELECT 
        USING (true);
    END IF;
END
$$;
