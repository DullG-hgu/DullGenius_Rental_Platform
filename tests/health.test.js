// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const health = require('../netlify/functions/health.js').handler;

beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.invalid');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const expectNoLeak = (response) => {
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.body).not.toContain('example.invalid');
    expect(response.body).not.toContain('sb_publishable_test');
};

it('DB 조회 성공이면 200 { ok: true }', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetch);
    const response = await health({ httpMethod: 'GET' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expectNoLeak(response);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetch.mock.calls[0];
    expect(calledUrl).toBe('https://example.invalid/rest/v1/games?select=id&limit=1');
    expect(init.headers).toEqual({ apikey: 'sb_publishable_test' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
});

it('DB가 오류 응답이면 503 { ok: false }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 544 }));
    const response = await health({ httpMethod: 'GET' });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ ok: false });
    expectNoLeak(response);
});

it('네트워크 오류면 503 이고 오류 상세를 응답에 넣지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED secret-detail')));
    const response = await health({ httpMethod: 'GET' });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ ok: false });
    expect(response.body).not.toContain('secret-detail');
    expectNoLeak(response);
});

it('5초 안에 응답이 없으면 요청을 끊고 503', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
        });
    }));
    vi.stubGlobal('fetch', fetch);
    const pending = health({ httpMethod: 'GET' });
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ ok: false });
    expectNoLeak(response);
});

it('환경변수가 없거나 publishable 키가 아니면 요청 없이 503', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const value of ['', 'sb_secret_server', 'eyJ_legacy']) {
        vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', value);
        const response = await health({ httpMethod: 'GET' });
        expect(response.statusCode).toBe(503);
        expect(JSON.parse(response.body)).toEqual({ ok: false });
        if (value) expect(response.body).not.toContain(value);
    }
    expect(fetch).not.toHaveBeenCalled();
});
