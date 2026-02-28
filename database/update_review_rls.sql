-- update_review_rls.sql
-- reviews 테이블에 UPDATE RLS 정책 추가
-- Supabase 대시보드 > SQL Editor에서 실행하세요.

-- 본인 리뷰만 수정 가능 정책
CREATE POLICY "본인 리뷰 수정 가능"
ON public.reviews
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
