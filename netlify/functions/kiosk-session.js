// netlify/functions/kiosk-session.js
// 최종 수정일: 2026.08.02
//
// 키오스크 기기에 Supabase 세션을 발급한다.
//
// ── 왜 이 함수가 필요한가 ─────────────────────────────────────────
// 이전에는 KioskPage 가 import.meta.env.VITE_KIOSK_EMAIL / VITE_KIOSK_PASSWORD 로
// 직접 로그인했다. 그런데 VITE_ 접두 환경변수는 빌드 시 번들에 "문자열로 박히므로",
// 배포된 JS 를 열면 키오스크 계정의 아이디·비밀번호가 그대로 보였다.
// (실제로 /assets/KioskPage-*.js 에서 평문 노출이 확인됨)
//
// 비밀번호만 교체해도 소용이 없다. 다음 빌드에서 새 비밀번호가 똑같이 박힌다.
// 브라우저가 알아야 하는 값은 사용자도 알 수 있기 때문이다. 구조를 바꿔야 한다.
//
// ── 어떻게 바뀌나 ────────────────────────────────────────────────
// 키오스크 계정의 자격증명은 이 함수(서버)에만 둔다. 클라이언트는 기기에 저장해둔
// 마스터키만 보내고, 검증에 성공하면 서버가 대신 로그인해서 "세션 토큰"만 돌려준다.
// 세션 토큰은 정상 로그인해도 클라이언트가 갖게 되는 값이므로 추가 노출이 아니다.
//
//   기기 localStorage(마스터키) → 이 함수 → Supabase 로그인 → access/refresh 토큰
//
// 마스터키를 기기에 두는 것과 세션을 기기에 두는 것은 같은 신뢰 수준이다.
// 마스터키 쪽을 택한 이유는 세션이 만료돼도 사람 없이 자동 복구되기 때문 —
// 오피스아워가 학기 초에만 열려 키오스크가 대부분 무인으로 돌아간다.
//
// ── 필요한 환경변수 (전부 VITE_ 접두 없이 = 서버 전용) ────────────
//   KIOSK_MASTER_KEY   기기 인증용. 길고 무작위여야 함(32자 이상 권장)
//   KIOSK_MASTER_KEY_PREVIOUS  키 회전 중에만 허용할 이전 키 (선택)
//   KIOSK_EMAIL        키오스크 계정 이메일
//   KIOSK_PASSWORD     키오스크 계정 비밀번호
//   SUPABASE_URL       (없으면 VITE_SUPABASE_URL 로 대체)
//   SUPABASE_PUBLISHABLE_KEY  (기존 *_ANON_KEY 변수명은 전환 기간에만 대체 사용)
//
// ⚠️ KIOSK_EMAIL / KIOSK_PASSWORD 에 절대 VITE_ 를 붙이지 말 것.
//    붙이는 순간 다시 번들에 박힌다.

const crypto = require('crypto');

// 브루트포스 지연 (ms). 마스터키가 충분히 길면 이것만으로도 현실적 공격은 불가능.
const BRUTE_FORCE_DELAY_MS = 1000;

// IP 당 허용 시도. Netlify 함수는 상태가 없어 콜드 스타트마다 초기화되는
// 베스트에포트 제한이다. 진짜 방어선은 "길고 무작위한 마스터키".
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const attempts = new Map();

const isRateLimited = (ip) => {
    const now = Date.now();
    const entry = attempts.get(ip);

    if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
        attempts.set(ip, { start: now, count: 1 });
        return false;
    }

    entry.count += 1;

    // 맵이 무한정 커지지 않도록 가끔 청소
    if (attempts.size > 500) {
        for (const [key, value] of attempts) {
            if (now - value.start > RATE_LIMIT_WINDOW_MS) attempts.delete(key);
        }
    }

    return entry.count > RATE_LIMIT_MAX;
};

// 길이가 달라도 안전하게 비교 (해시로 길이를 고정한 뒤 timingSafeEqual)
const safeEqual = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
};

// 배포 사이트 오리진만 허용. curl 은 어차피 막지 못하므로 위생 목적이다.
const allowedOrigin = (origin) => {
    const allowList = [process.env.URL, process.env.DEPLOY_PRIME_URL].filter(Boolean);
    if (allowList.length === 0) return '*';
    return allowList.includes(origin) ? origin : allowList[0];
};

exports.handler = async function (event) {
    const origin = event.headers?.origin || '';
    const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin(origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Cache-Control': 'no-store',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ success: false }) };
    }

    const ip = event.headers?.['x-nf-client-connection-ip']
        || event.headers?.['x-forwarded-for']
        || 'unknown';

    if (isRateLimited(ip)) {
        return {
            statusCode: 429,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: '잠시 후 다시 시도해 주세요.' }),
        };
    }

    // 성공/실패 모두 동일하게 지연시켜 타이밍으로 구분되지 않도록 한다
    await new Promise((resolve) => setTimeout(resolve, BRUTE_FORCE_DELAY_MS));

    let key;
    try {
        ({ key } = JSON.parse(event.body || '{}'));
    } catch {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success: false }) };
    }

    const masterKey = process.env.KIOSK_MASTER_KEY;
    const previousMasterKey = process.env.KIOSK_MASTER_KEY_PREVIOUS;
    const email = process.env.KIOSK_EMAIL;
    const password = process.env.KIOSK_PASSWORD;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY
        || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
        || process.env.SUPABASE_ANON_KEY
        || process.env.VITE_SUPABASE_ANON_KEY;

    if (!masterKey || !email || !password || !supabaseUrl || !supabaseKey) {
        // 설정 누락은 서버 로그에만 남긴다. 어떤 값이 빠졌는지 응답에 싣지 않는다.
        console.error('kiosk-session: 환경변수 누락', {
            hasMasterKey: !!masterKey,
            hasEmail: !!email,
            hasPassword: !!password,
            hasSupabaseUrl: !!supabaseUrl,
            hasSupabaseKey: !!supabaseKey,
        });
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: '키오스크 설정이 완료되지 않았습니다.' }),
        };
    }

    const matchesCurrentKey = typeof key === 'string' && safeEqual(key, masterKey);
    const matchesPreviousKey = typeof key === 'string'
        && !!previousMasterKey
        && safeEqual(key, previousMasterKey);

    if (!matchesCurrentKey && !matchesPreviousKey) {
        return {
            statusCode: 401,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: '기기 인증에 실패했습니다.' }),
        };
    }

    // 마스터키 검증 통과 → 서버가 대신 로그인해서 세션만 돌려준다
    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                apikey: supabaseKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('kiosk-session: Supabase 로그인 실패', response.status, data?.error_description || data?.msg);
            return {
                statusCode: 502,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, message: '키오스크 계정 로그인에 실패했습니다.' }),
            };
        }

        // 세션 토큰만 전달. 이메일·비밀번호는 절대 응답에 포함하지 않는다.
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                // 이전 키로 접속한 기기는 세션을 유지하되 새 키 재등록을 요청한다.
                key_rotation_required: matchesPreviousKey,
            }),
        };
    } catch (error) {
        console.error('kiosk-session: 예외', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: '세션 발급 중 오류가 발생했습니다.' }),
        };
    }
};
