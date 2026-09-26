// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const bgg = require('../netlify/functions/bgg-proxy.js').handler;

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

// 브라우저로 위장한 UA는 BGG(Cloudflare)가 유효 토큰이어도 403으로 막는다 (2026-09-27 운영 장애)
it('BGG 요청에 브라우저 위장 UA 대신 앱 식별 UA를 보낸다', async () => {
    vi.stubEnv('BGG_API_TOKEN', 'test-token');
    const fetch = vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => '<items></items>' });
    vi.stubGlobal('fetch', fetch);
    const response = await bgg({ httpMethod: 'GET', queryStringParameters: { action: 'search', query: '카탄' } });
    expect(response.statusCode).toBe(200);
    const { headers } = fetch.mock.calls[0][1];
    expect(headers['User-Agent']).toMatch(/^dullgrental\//);
    expect(headers['User-Agent']).not.toMatch(/Mozilla|Chrome|Safari/);
    expect(headers.Authorization).toBe('Bearer test-token');
});
