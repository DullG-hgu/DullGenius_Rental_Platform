-- ================================================================
-- MIGRATION: backfill_review_user_id
-- 날짜: 2026-10-01
-- 배경: 2025-12-26 ~ 2026-01-12 에 쓰인 옛 리뷰는 작성자 계정(user_id)이 비어 있어
--   성향검사 배지(spec_fun_quiz.md §6)가 붙지 않고, 본인이 수정·삭제할 수도 없었다.
--   확인해 보니 한 회원의 리뷰 9개가 내용·별점·작성 시각까지 같은 사본으로 세 번씩 저장돼 있었다
--   (리뷰 37~45, 55~63, 73~81). 화면은 fetchReviews 의 중복 제거로 하나씩만 보였다.
--
-- 1) 사본 정리: user_id 가 비어 있고 게임·작성자·내용·별점·작성 시각이 모두 같은 리뷰는 가장 앞 번호만 남긴다.
--    삭제 전 사본은 로컬 `Supabase backup/2026-10-01_review-duplicates-18.json` 에 백업(커밋 금지 폴더).
-- 2) 계정 채우기: 작성자 이름이 회원 이름과 **정확히 한 명**으로 일치하는 리뷰만 user_id 를 채운다.
--    이미 user_id 가 있는 리뷰, 동명이인, 미일치 리뷰는 건드리지 않는다.
-- 부작용(의도됨): 계정이 채워진 회원은 "Manage Own Reviews" 정책으로 자기 옛 리뷰를 수정·삭제할 수 있다.
-- 다시 실행해도 안전하다 (user_id IS NULL 인 행만 대상). 사용자 승인 후 적용 (2026-10-01).
-- ================================================================

DELETE FROM public.reviews d
USING public.reviews k
WHERE d.user_id IS NULL AND k.user_id IS NULL
  AND d.review_id > k.review_id
  AND d.game_id IS NOT DISTINCT FROM k.game_id
  AND d.author_name = k.author_name
  AND d.content IS NOT DISTINCT FROM k.content
  AND d.rating IS NOT DISTINCT FROM k.rating
  AND d.created_at IS NOT DISTINCT FROM k.created_at;

UPDATE public.reviews r
SET user_id = m.profile_id
FROM (
  SELECT rv.review_id, min(p.id::text)::uuid AS profile_id
  FROM public.reviews rv
  JOIN public.profiles p ON trim(p.name) = trim(rv.author_name)
  WHERE rv.user_id IS NULL
  GROUP BY rv.review_id
  HAVING count(*) = 1
) m
WHERE r.review_id = m.review_id
  AND r.user_id IS NULL;
