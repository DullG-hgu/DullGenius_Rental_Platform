// 입부 신청 폼 수신 — 캡처가 같이 온 경우 (spec_dues_capture.md §3-2).
//
//   Apps Script(폼 제출) → 이 함수 → 오라클 OCR → 규칙 → RPC ingest_member_application (anon 키 + 폼 공유 비밀값)
//
// - 폼 공유 비밀값은 이 함수가 알지 못한다. 받은 값을 RPC 로 그대로 넘기고 검증은 DB 가 한다.
// - 캡처가 없거나 이 함수가 실패하면 Apps Script 가 RPC 를 직접 불러 신청만 넣는다(신규 부원이 막히지 않게).
// - 캡처 원본은 구글 드라이브(폼 응답 폴더)에 남는다. 여기서는 보관하지 않고 드라이브 파일 id 만 기록한다.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { judgeDuesCapture } = require('./_shared/duesRules');
const { _internal: { readText, normalizeAccounts } } = require('./dues-proof');

const MAX_IMAGE_BYTES = 4_000_000; // 폼은 원본 사진이 온다. Netlify 본문 제한(6MB, base64) 안쪽
const ALLOWED_MIME = ['image/jpeg', 'image/webp', 'image/png'];

const json = (statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
});

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') return json(405, { success: false, message: 'method' });

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return json(500, { success: false, message: 'not_configured' });

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return json(400, { success: false, message: 'bad_request' });
    }
    const application = body.application && typeof body.application === 'object' ? body.application : null;
    const secret = typeof body.secret === 'string' ? body.secret : '';
    // 비밀값 모양이 아니면 글자 인식을 돌리기 전에 끊는다 (검증 자체는 DB 가 한다)
    if (!application || secret.length < 32) return json(401, { success: false, message: '인증 실패' });

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });

    let proof = null;
    const mime = String(body.mime || '');
    const base64 = typeof body.image === 'string' ? body.image : '';
    if (base64 && ALLOWED_MIME.includes(mime)) {
        const bytes = Buffer.from(base64, 'base64');
        if (bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES) {
            // 계좌는 비회원(anon)에게 닫혀 있다 — 폼 공유 비밀값을 확인하는 RPC 로 받는다. 실패하면 금액만으로 판정한다.
            const [{ data: amountRow }, { data: accounts }] = await Promise.all([
                supabase.from('app_config').select('value').eq('key', 'dues_amount').maybeSingle(),
                supabase.rpc('dues_accounts_for_form', { p_secret: secret }),
            ]);
            const config = { dues_amount: amountRow?.value, dues_account: accounts };
            const texts = await readText(bytes, mime, { url: process.env.DUES_OCR_URL, secret: process.env.DUES_OCR_SECRET });
            const verdict = texts
                ? judgeDuesCapture(texts, { amount: Number(config.dues_amount), accounts: normalizeAccounts(config.dues_account) })
                : { status: 'pending_review', reason: 'ocr_unavailable', amount: null, accountTail: null };
            proof = {
                // 폼은 다시 찍어 달라고 할 수 없다 — 안 읽힌 건은 운영진 확인으로
                status: verdict.status === 'retry' ? 'pending_review' : verdict.status,
                reason: verdict.reason,
                amount: verdict.amount,
                account_tail: verdict.accountTail,
                file_ref: typeof body.file_ref === 'string' ? body.file_ref.slice(0, 200) : null,
                file_hash: crypto.createHash('sha256').update(bytes).digest('hex'),
            };
        }
    }

    const { data, error } = await supabase.rpc('ingest_member_application', {
        p_payload: { ...application, secret, ...(proof ? { proof } : {}) },
    });
    if (error) return json(502, { success: false, message: 'server' });
    return json(200, data);
};
