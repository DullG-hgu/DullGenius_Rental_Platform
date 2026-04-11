-- ========================================
-- CSV 기반 quantity 정확한 설정
-- ========================================

-- 1. 모든 게임을 기본 1개로 설정
UPDATE public.games SET quantity = 1;

-- 2. 중복 게임들만 정확한 수량 설정
-- (CSV에서 같은 이름으로 여러 행이 있는 게임들)

-- 보난자 (2개)
UPDATE public.games SET quantity = 2 WHERE id IN (55, 56);

-- 스플렌더 (2개)
UPDATE public.games SET quantity = 2 WHERE id IN (77, 78);

-- 시타델 (2개)
UPDATE public.games SET quantity = 2 WHERE id IN (82, 83);

-- 아컴호러 카드게임 (2개)
UPDATE public.games SET quantity = 2 WHERE id IN (88, 89);

-- 타코 캣 고트 치즈 피자 (2개)
UPDATE public.games SET quantity = 2 WHERE id IN (154, 155);

-- 테라포밍 마스 (2개)
UPDATE public.games SET quantity = 2 WHERE id IN (158, 159);

-- TEXAS HOLD'EM POKER SET (3개)
UPDATE public.games SET quantity = 3 WHERE id IN (190, 191, 192);

-- 시체와 온천 (2개)
UPDATE public.games SET quantity = 2 WHERE id IN (80, 199);

-- 3. 확인
SELECT id, name, quantity
FROM public.games
WHERE quantity > 1
ORDER BY quantity DESC, name;

-- 예상 결과:
-- TEXAS HOLD'EM POKER SET: 3
-- 나머지: 2
