// src/lib/gamesRealtime.js
import { supabase } from './supabaseClient.jsx';

/**
 * games 테이블 변경을 구독해 "뭔가 바뀌었다" 신호를 넘겨주는 공용 헬퍼.
 *
 * 왜 rentals 가 아니라 games 를 신호로 쓰나:
 *   rentals 는 RLS 가 `returned_at IS NULL` 인 행만 공개한다. 반납으로 행이 닫히면
 *   그 UPDATE 이벤트는 일반 구독자에게 전달되지 않을 수 있다(공개 조건에서 벗어나므로).
 *   반면 대여·찜·반납·크론 정리가 모두 recalc 를 거쳐 games.available_count 를
 *   UPDATE 하도록 정리돼 있어, games(공개 SELECT) 이벤트 하나로 모든 상태 변화를 덮는다.
 *
 * 실패해도 앱은 그대로 돌아간다. 구독이 안 되면 기존 수동 갱신 경로만 남을 뿐이다.
 *
 * @param {Object}   opts
 * @param {Function} opts.onChange     - 변경 감지 시 디바운스 후 호출
 * @param {Function} [opts.onReconnect]- 끊겼다 다시 붙었을 때 1회 호출 (최초 연결은 제외)
 * @param {string}   [opts.channelName]- 채널 이름. 화면마다 다르게 준다
 * @param {number}   [opts.debounceMs] - 이벤트 폭주(전체 재계산) 대비 디바운스
 * @returns {Function} 구독 해제 함수 (항상 호출 가능. 구독 실패 시엔 no-op)
 */
export const subscribeToGameChanges = ({
    onChange,
    onReconnect,
    channelName = 'games-sync',
    debounceMs = 1500
}) => {
    let timer = null;
    let channel = null;
    let disposed = false;
    // 최초 SUBSCRIBED 는 재연결이 아니다. 그때는 이미 화면이 방금 데이터를 읽은 직후다.
    let connectedBefore = false;

    const runDebounced = () => {
        if (disposed) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            if (disposed) return;
            try {
                onChange();
            } catch (e) {
                console.warn('[realtime] 변경 반영 실패:', e);
            }
        }, debounceMs);
    };

    try {
        channel = supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'games' },
                runDebounced
            )
            .subscribe((status) => {
                if (disposed) return;
                if (status === 'SUBSCRIBED') {
                    if (connectedBefore && onReconnect) {
                        // 오프라인 동안 놓친 변경을 한 번에 따라잡는다.
                        // (키오스크는 네트워크가 끊겼다 붙는 일이 잦다)
                        try {
                            onReconnect();
                        } catch (e) {
                            console.warn('[realtime] 재연결 동기화 실패:', e);
                        }
                    }
                    connectedBefore = true;
                }
            });
    } catch (e) {
        // Realtime 미지원·연결 실패 — 조용히 포기한다. 수동 갱신 경로는 그대로 살아 있다.
        console.warn('[realtime] 구독할 수 없어 수동 갱신으로만 동작합니다:', e);
        channel = null;
    }

    return () => {
        disposed = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (channel) {
            try {
                supabase.removeChannel(channel);
            } catch (e) {
                console.warn('[realtime] 채널 해제 실패:', e);
            }
            channel = null;
        }
    };
};
