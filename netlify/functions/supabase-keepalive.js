// ================================================================
// Netlify Scheduled Function: supabase-keepalive
// 목적: Supabase 무료 티어의 "7일 무활동 시 프로젝트 일시정지" 방지
//
// 배경: 만료 찜 정리는 pg_cron(DB 내부)으로 이전됐는데, 내부 실행은
// Supabase의 활동으로 집계되지 않는다. 프로젝트가 정지되면 pg_cron도
// 함께 멎으므로, 외부에서 매일 한 번 REST API 핑을 넣어 활동을 유지한다.
// (이전에는 GitHub Actions 크론이 10분마다 REST를 호출해 의도치 않게
//  이 역할을 하고 있었다 — 그 워크플로 제거로 생긴 공백을 메운다.)
//
// 스케줄은 netlify.toml의 [functions."supabase-keepalive"]에서 선언한다.
// ================================================================

exports.handler = async () => {
    const url =
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key =
        process.env.SUPABASE_PUBLISHABLE_KEY ||
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !key) {
        console.error('[keepalive] Supabase URL/키 환경변수 누락');
        return { statusCode: 500, body: 'missing env' };
    }

    // 공개 읽기 가능한 테이블에 최소 조회 1건 — RLS상 안전하고 활동으로 집계된다
    const res = await fetch(`${url}/rest/v1/games?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
    });

    if (!res.ok) {
        console.error(`[keepalive] 핑 실패: HTTP ${res.status}`);
        return { statusCode: 500, body: `ping failed: ${res.status}` };
    }

    console.log('[keepalive] Supabase 핑 성공');
    return { statusCode: 200, body: 'ok' };
};
