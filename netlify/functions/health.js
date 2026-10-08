// ================================================================
// Netlify Function: health
// 목적: 외부 감시 서비스(UptimeRobot 등)가 주기적으로 GET 해서
//       사이트(Netlify) + DB(Supabase)가 살아 있는지 확인하는 엔드포인트
//
// 배경: 2026-10-04 16:33~16:57 KST 운영 Supabase가 무응답이 되어
// 25분 다운됐는데 아무 알림도 없었다. 이 함수가 503을 돌려주면
// 감시 서비스가 운영자에게 메일을 보낸다. (설정: docs/uptime-monitoring.md)
//
// - 스케줄 함수가 아니다. netlify.toml에 스케줄을 추가하지 않는다.
// - 응답에는 ok 여부만 담는다. 오류 상세·키·URL은 로그에만 남긴다.
// - 감시 서비스가 HEAD로 부를 수도 있어 메서드는 가리지 않는다.
// ================================================================

const TIMEOUT_MS = 5000;

const respond = (statusCode, ok) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ ok }),
});

exports.handler = async () => {
    const url =
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key =
        process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key || '')) {
        console.error('[health] Supabase URL/키 환경변수 누락');
        return respond(503, false);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        // 공개 읽기 가능한 테이블에 최소 조회 1건 (keepalive와 같은 쿼리)
        const res = await fetch(`${url}/rest/v1/games?select=id&limit=1`, {
            headers: { apikey: key },
            signal: controller.signal,
        });

        if (!res.ok) {
            console.error(`[health] DB 조회 실패: HTTP ${res.status}`);
            return respond(503, false);
        }

        return respond(200, true);
    } catch (err) {
        const reason = err && err.name === 'AbortError' ? `타임아웃(${TIMEOUT_MS}ms)` : (err && err.message) || 'unknown';
        console.error(`[health] DB 조회 오류: ${reason}`);
        return respond(503, false);
    } finally {
        clearTimeout(timer);
    }
};
