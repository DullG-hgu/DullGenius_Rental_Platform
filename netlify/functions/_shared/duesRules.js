// 회비 이체 캡처 판정 규칙 (spec_dues_capture.md §4).
//
// 입력은 글자뿐이다 — 오라클 OCR 서비스가 한 장을 여러 방식(psm 6·11, 원본·색 반전)으로
// 읽어 준 글자 묶음. 이 모듈은 그림·DB·네트워크를 건드리지 않는다.
// 중복(파일 해시)·되돌린 이력·자격 확인은 DB 쪽(dues_submit_proof)의 몫이다.
//
// 화면에 없는 것: 날짜, 보낸 사람. 여기서는 「회비 금액이 찍힌 화면인가」만 본다.
// 계좌·예금주·금액은 관리자 설정값으로 받는다. 저장소가 공개라 실제 값을 코드에 적지 않는다.

// 계좌번호 후보: 숫자·하이픈이 이어진 것 중 숫자가 10자리 이상.
const ACCOUNT_CANDIDATE = /\d[\d-]{8,}\d/g;

const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');
const flatten = (s) => String(s ?? '').replace(/\s+/g, '');

// 화면 어디든 있는 「N원」을 모은다.
function readLooseAmounts(flatTexts, expected) {
    const expectedDigits = String(expected);
    const found = new Set();
    for (const flat of flatTexts) {
        for (const m of flat.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)원/g)) {
            const raw = m[1].replace(/,/g, '');
            // 「20.000원」처럼 쉼표를 잘못 읽으면 뒤쪽 「000」만 잡힌다 — 읽다 만 조각이라 버린다.
            if (raw.startsWith('0') && raw.length < expectedDigits.length && expectedDigits.endsWith(raw)) continue;
            found.add(Number(raw));
        }
    }
    return [...found];
}

function readAccounts(texts) {
    const found = new Set();
    for (const text of texts) {
        for (const m of String(text ?? '').matchAll(ACCOUNT_CANDIDATE)) {
            const d = digitsOnly(m[0]);
            if (d.length >= 10) found.add(d);
        }
    }
    return found;
}

/**
 * 기준 (2026-11-11 사용자 결정): **회비 금액이 화면에 있으면 통과.** 완료 문구·계좌·예금주로는 막지 않는다.
 * 계좌·예금주가 맞았는지는 reason 으로만 남겨 관리자 목록에서 구분해 볼 수 있게 한다.
 *
 * @param {string[]} texts  같은 캡처를 여러 방식으로 읽은 글자들
 * @param {{ amount: number, accounts?: { number: string, holder: string }[] }} config
 * @returns {{ status: 'approved'|'pending_review'|'rejected'|'retry',
 *             reason: string, amount: number|null, accountTail: string|null }}
 *   approved 의 reason: account_match(계좌까지 일치) / holder_only(예금주 이름만) / amount_only(금액만)
 *   retry = 금액이 하나도 안 읽혔으니 다시 찍어 달라고 한다. 두 번째에도 retry 면 부르는 쪽이 pending_review 로 바꾼다.
 */
function judgeDuesCapture(texts, config) {
    const out = (status, reason, amount = null, accountTail = null) => ({ status, reason, amount, accountTail });

    const expected = Number(config?.amount);
    // 금액 설정이 비어 있으면 자동 판정하지 않는다 — 화면에서도 버튼을 숨긴다.
    if (!Number.isInteger(expected) || expected <= 0) return out('pending_review', 'not_configured');
    const accounts = (config?.accounts ?? [])
        .map((a) => ({ number: digitsOnly(a?.number), holder: flatten(a?.holder) }));

    const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => typeof t === 'string' && t.trim());
    if (list.length === 0) return out('pending_review', 'ocr_unavailable');
    const flats = list.map(flatten);

    const amounts = readLooseAmounts(flats, expected);
    if (amounts.length === 0) return out('retry', 'amount_unread');
    if (!amounts.includes(expected)) return out('rejected', 'amount_mismatch', Math.max(...amounts));

    const seen = readAccounts(list);
    const hit = accounts.find((a) => a.number.length >= 10 && seen.has(a.number));
    if (hit) return out('approved', 'account_match', expected, hit.number.slice(-4));
    const holderHit = accounts.some((a) => a.holder && flats.some((f) => f.includes(a.holder)));
    return out('approved', holderHit ? 'holder_only' : 'amount_only', expected);
}

module.exports = { judgeDuesCapture };
