// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

// Supabase 클라이언트는 네트워크를 타므로 캐시에 스텁을 넣고 함수를 불러온다.
const db = { user: { id: 'u1' }, mine: null, config: [], uploads: [], submitted: [], submitResult: null };
beforeAll(() => {
    const path = require.resolve('@supabase/supabase-js');
    require.cache[path] = {
        id: path, filename: path, loaded: true,
        exports: {
            createClient: () => ({
                auth: { getUser: async () => (db.user ? { data: { user: db.user }, error: null } : { data: {}, error: new Error('no') }) },
                rpc: async (name, args) => {
                    if (name === 'dues_my_proof_status') return { data: db.mine, error: null };
                    if (name === 'dues_my_accounts') return { data: db.config.find((r) => r.key === 'dues_account')?.value ?? [], error: null };
                    db.submitted.push(args.p_payload);
                    return { data: db.submitResult ?? { success: true, status: args.p_payload.status, reason: args.p_payload.reason }, error: null };
                },
                from: () => ({ select: () => ({ in: async () => ({ data: db.config, error: null }) }) }),
                storage: { from: () => ({ upload: async (path) => { db.uploads.push(path); return { error: null }; } }) },
            }),
        },
    };
});
const handler = (...args) => require('../netlify/functions/dues-proof.js').handler(...args);
const event = (body = {}) => ({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token' },
    body: JSON.stringify({ image: Buffer.from('fake-image').toString('base64'), mime: 'image/jpeg', ...body }),
});
const ocr = (texts, ok = true) => vi.fn(async () => ({ ok, json: async () => ({ texts }) }));
const run = async (ev = event()) => JSON.parse((await handler(ev)).body);

beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubEnv('DUES_RPC_SECRET', 'rpc-secret');
    vi.stubEnv('DUES_OCR_URL', 'https://ocr.example/ocr');
    vi.stubEnv('DUES_OCR_SECRET', 'ocr-secret');
    Object.assign(db, {
        user: { id: 'u1' }, uploads: [], submitted: [], submitResult: null,
        mine: { eligibility: 'ok', semester: '2026-2', rejected_today: 0, daily_limit: 5 },
        config: [{ key: 'dues_amount', value: 20000 }, { key: 'dues_account', value: [{ bank: '시험은행', number: '1234-56-7890123', holder: '홍길동' }] }],
    });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('dues-proof 함수', () => {
    it('토큰이 없으면 401, 서버 비밀값이 없으면 판정하지 않는다', async () => {
        vi.stubGlobal('fetch', vi.fn());
        expect((await handler({ ...event(), headers: {} })).statusCode).toBe(401);
        vi.stubEnv('DUES_RPC_SECRET', '');
        expect(await run()).toEqual({ ok: false, error: 'not_configured' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('자격이 없거나 하루 한도를 넘으면 글자 인식을 부르지 않는다', async () => {
        vi.stubGlobal('fetch', vi.fn());
        db.mine = { eligibility: 'need_form' };
        expect(await run()).toEqual({ ok: false, error: 'need_form' });
        db.mine = { eligibility: 'ok', rejected_today: 5, daily_limit: 5 };
        expect(await run()).toEqual({ ok: false, error: 'daily_limit' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('금액이 맞으면 그림을 보관하고 비밀값과 함께 허가를 기록한다', async () => {
        const fetchMock = ocr(['홍길동님에게\n20,000원 보냈어요\n1234-56-7890123']);
        vi.stubGlobal('fetch', fetchMock);
        expect(await run()).toEqual({ ok: true, status: 'approved', reason: 'account_match' });
        expect(fetchMock.mock.calls[0][1].headers['X-Ocr-Secret']).toBe('ocr-secret');
        expect(db.uploads[0]).toMatch(/^2026-2\/u1\/[0-9a-f-]+\.jpg$/);
        expect(db.submitted[0]).toMatchObject({ secret: 'rpc-secret', status: 'approved', amount: 20000, account_tail: '0123', image_path: db.uploads[0] });
        expect(db.submitted[0].file_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('반려된 그림은 보관하지 않는다', async () => {
        vi.stubGlobal('fetch', ocr(['홍길동님에게 1원을 보냈어요']));
        expect(await run()).toMatchObject({ ok: true, status: 'rejected', reason: 'amount_mismatch' });
        expect(db.uploads).toHaveLength(0);
        expect(db.submitted[0].image_path).toBeNull();
    });

    it('금액이 안 읽히면 처음엔 기록 없이 다시 찍게 하고, 두 번째엔 운영진 확인으로 넘긴다', async () => {
        vi.stubGlobal('fetch', ocr(['홍길동님에게 보냈어요']));
        expect(await run()).toEqual({ ok: true, status: 'retry', reason: 'amount_unread' });
        expect(db.submitted).toHaveLength(0);
        expect(await run(event({ attempt: 2 }))).toMatchObject({ ok: true, status: 'pending_review', reason: 'amount_unread' });
        expect(db.uploads).toHaveLength(1);
    });

    it('글자 인식 서버가 죽었으면 반려하지 않고 운영진 확인으로 넘긴다', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
        expect(await run()).toMatchObject({ ok: true, status: 'pending_review', reason: 'ocr_unavailable' });
        vi.stubGlobal('fetch', ocr([], false));
        expect(await run()).toMatchObject({ status: 'pending_review' });
    });

    it('DB 가 판정을 바꾸면(중복 등) 그 결과를 돌려준다', async () => {
        vi.stubGlobal('fetch', ocr(['20,000원 보냈어요']));
        db.submitResult = { success: true, status: 'rejected', reason: 'duplicate' };
        expect(await run()).toEqual({ ok: true, status: 'rejected', reason: 'duplicate' });
        db.submitResult = { success: false, error: 'paid' };
        expect(await run()).toEqual({ ok: false, error: 'paid' });
    });

    it('그림이 아니거나 너무 크면 400', async () => {
        vi.stubGlobal('fetch', vi.fn());
        expect((await handler(event({ mime: 'application/pdf' }))).statusCode).toBe(400);
        expect((await handler(event({ image: Buffer.alloc(1_600_000).toString('base64') }))).statusCode).toBe(400);
    });
});
