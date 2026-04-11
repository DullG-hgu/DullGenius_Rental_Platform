-- 1. 만료된 찜 정리 함수 생성 (V2 호환 버전)
-- GitHub Action에서 이 함수를 호출합니다.
create or replace function public.cleanup_expired_dibs()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  -- A. 만료된(30분이 지난) 찜 찾아서 반납(종료) 처리 및 게임 ID 수집
  with expired as (
    update public.rentals
    set returned_at = now()
    where type = 'DIBS'
      and returned_at is null
      and due_date < now()
    returning game_id
  )
  -- B. 가용 수량 복구 (games 테이블)
  update public.games g
  set available_count = available_count + sub.cnt
  from (
    select game_id, count(*) as cnt
    from expired
    group by game_id
  ) sub
  where g.id = sub.game_id;

  get diagnostics v_count = row_count;

  return jsonb_build_object('success', true, 'cancelled_count', v_count);
end;
$$;
