// 회비 이체 캡처 인증 (spec_dues_capture.md).
//
//   브라우저(줄인 그림) → 이 함수 → 오라클 OCR(글자만) → 규칙(_shared/duesRules) → 보관소 저장 → RPC dues_submit_proof
//
// - 부원 본인 토큰으로만 동작한다. 판정 결과를 DB 에 쓸 때는 서버 비밀값(DUES_RPC_SECRET)을 같이 보내
//   부원이 RPC 를 직접 불러 「허가」를 써넣지 못하게 한다.
// - OCR 서버가 죽었거나 느리면 반려하지 않고 「운영진 확인」(pending_review)으로 넘긴다.
// - 그림·읽힌 글자는 기록(log)에 남기지 않는다.
//
// 서버 전용 환경변수 (VITE_ 금지): DUES_RPC_SECRET, DUES_OCR_URL, DUES_OCR_SECRET
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { judgeDuesCapture } = require('./_shared/duesRules');

const MAX_IMAGE_BYTES = 1_500_000; // 브라우저가 긴 변 1600px JPEG 로 줄여 보낸다 (보통 수백 KB)
const OCR_TIMEOUT_MS = 6000;       // Netlify 함수 제한(10초) 안에 끝내기 위한 상한
const ALLOWED_MIME = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

const json = (statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
});

// 글자 인식. 실패는 전부 null (부르는 쪽이 pending_review 로 넘긴다).
const readText = async (bytes, mime, { url, secret, fetchImpl = fetch, timeoutMs = OCR_TIMEOUT_MS }) => {
    if (!url || !secret) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': mime, 'X-Ocr-Secret': secret },
            body: bytes,
            signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = await res.json();
        return Array.isArray(data?.texts) ? data.texts.filter((t) => typeof t === 'string') : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

const normalizeAccounts = (value) => {
    const list = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);
    return list.map((v) => ({ number: String(v?.number ?? ''), holder: String(v?.holder ?? '') }));
};

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });

    const authorization = event.headers?.authorization || event.headers?.Authorization || '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!accessToken) return json(401, { ok: false, error: 'auth' });

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    const rpcSecret = process.env.DUES_RPC_SECRET;
    if (!supabaseUrl || !supabaseKey || !rpcSecret) return json(200, { ok: false, error: 'not_configured' });

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return json(400, { ok: false, error: 'bad_request' });
    }
    const mime = String(body.mime || '');
    const ext = ALLOWED_MIME[mime];
    const base64 = typeof body.image === 'string' ? body.image.replace(/^data:[^,]*,/, '') : '';
    if (!ext || !base64) return json(400, { ok: false, error: 'bad_image' });
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return json(400, { ok: false, error: 'too_large' });
    const attempt = Number(body.attempt) || 1;

    const supabase = createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user } = {}, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !user) return json(401, { ok: false, error: 'auth' });

    // 글자 인식 전에 자격·횟수부터 본다 (서버 자원을 아낀다. RPC 가 마지막에 다시 확인한다)
    const { data: mine, error: mineError } = await supabase.rpc('dues_my_proof_status');
    if (mineError) return json(200, { ok: false, error: 'server' });
    if (mine?.eligibility !== 'ok') return json(200, { ok: false, error: mine?.eligibility || 'server' });
    if ((mine.rejected_today ?? 0) >= (mine.daily_limit ?? 5)) return json(200, { ok: false, error: 'daily_limit' });

    const { data: configRows, error: configError } = await supabase
        .from('app_config').select('key, value').in('key', ['dues_amount', 'dues_account']);
    if (configError) return json(200, { ok: false, error: 'server' });
    const config = Object.fromEntries((configRows || []).map((r) => [r.key, r.value]));
    // 계좌 행은 부원이 app_config 에서 직접 읽지 못한다 — 본인용 RPC 로 받는다. 못 받아도 금액만으로 판정한다.
    const { data: myAccounts } = await supabase.rpc('dues_my_accounts');
    config.dues_account = myAccounts;

    const texts = await readText(bytes, mime, { url: process.env.DUES_OCR_URL, secret: process.env.DUES_OCR_SECRET });
    let verdict = texts
        ? judgeDuesCapture(texts, { amount: Number(config.dues_amount), accounts: normalizeAccounts(config.dues_account) })
        : { status: 'pending_review', reason: 'ocr_unavailable', amount: null, accountTail: null };

    if (verdict.status === 'retry') {
        // 첫 번째는 기록 없이 다시 찍게 한다. 두 번째에도 안 읽히면 운영진에게 넘긴다.
        if (attempt < 2) return json(200, { ok: true, status: 'retry', reason: verdict.reason });
        verdict = { ...verdict, status: 'pending_review' };
    }

    // 반려된 그림은 보관하지 않는다. 허가·확인 필요만 올린다 (실패해도 판정은 기록한다).
    let imagePath = null;
    if (verdict.status !== 'rejected') {
        const path = `${mine.semester}/${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('dues-proofs').upload(path, bytes, { contentType: mime, upsert: false });
        if (!uploadError) imagePath = path;
    }

    const { data: saved, error: saveError } = await supabase.rpc('dues_submit_proof', {
        p_payload: {
            secret: rpcSecret,
            status: verdict.status,
            reason: verdict.reason,
            amount: verdict.amount,
            account_tail: verdict.accountTail,
            image_path: imagePath,
            file_hash: crypto.createHash('sha256').update(bytes).digest('hex'),
        },
    });
    if (saveError || !saved?.success) return json(200, { ok: false, error: saved?.error || 'server' });
    return json(200, { ok: true, status: saved.status, reason: saved.reason });
};

exports._internal = { readText, normalizeAccounts };
