// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { parseBggThings, scoreGenres, pickSuggestions, GENRE_KEYS } = require('../netlify/functions/_shared/jevGenres.js');

// 관리자 인증은 네트워크를 타므로 캐시에 스텁을 넣고 함수를 불러온다.
let authResult = null;
beforeAll(() => {
    const authPath = require.resolve('../netlify/functions/_shared/authorizeAdmin.js');
    require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authorizeAdmin: async () => authResult } };
});
const handler = (...args) => require('../netlify/functions/jev-genre-suggest.js').handler(...args);
const event = (bgg_id = '13') => ({ httpMethod: 'GET', headers: { authorization: 'Bearer t' }, queryStringParameters: { bgg_id, name: '카탄' } });
const bggXml = '<items><item type="boardgame" id="13"><name type="primary" sortindex="1" value="CATAN"/>'
    + '<link type="boardgamecategory" id="1" value="Negotiation"/><link type="boardgamemechanic" id="2" value="Dice Rolling"/>'
    + '<minplayers value="3"/><maxplayers value="4"/><minplaytime value="60"/><maxplaytime value="120"/>'
    + '<statistics><ratings><averageweight value="2.28"/></ratings></statistics></item></items>';
const jevAnswers = Object.fromEntries(GENRE_KEYS.map((g, i) => [`g${i}`, { noul: g === '협상' ? 0.95 : g === '주사위' ? 0.7 : 0.1 }]));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    authResult = null;
});

describe('jev-genre-suggest 함수', () => {
    it('숫자가 아닌 bgg_id는 인증·외부 호출 전에 400', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        expect((await handler(event('13;drop'))).statusCode).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('관리자가 아니면 인증 오류를 그대로 돌려주고 외부 호출하지 않는다', async () => {
        authResult = { statusCode: 403, error: 'Administrator role required' };
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        expect((await handler(event())).statusCode).toBe(403);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('키가 없으면(구독 해지) 200 + available:false, 외부 호출 없음', async () => {
        vi.stubEnv('JEV_AI_API_KEY', '');
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const res = await handler(event());
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ available: false, reason: 'unconfigured' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('크레딧 소진(402)도 오류가 아니라 제안 없음으로 돌려준다', async () => {
        vi.stubEnv('JEV_AI_API_KEY', 'test-key');
        vi.stubEnv('BGG_API_TOKEN', 'bgg');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => bggXml })
            .mockResolvedValueOnce({ ok: false, status: 402 }));
        const res = await handler(event());
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ available: false, reason: 'quota' });
        expect(res.body).not.toContain('test-key');
    });

    it('정상 응답은 0.5 이상 후보만 확률순으로', async () => {
        vi.stubEnv('JEV_AI_API_KEY', 'test-key');
        vi.stubEnv('BGG_API_TOKEN', 'bgg');
        const fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => bggXml })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', answers: jevAnswers, usage: { input_tokens: 900 } }) });
        vi.stubGlobal('fetch', fetch);
        const body = JSON.parse((await handler(event())).body);
        expect(body.available).toBe(true);
        expect(body.suggestions.map(s => s.genre)).toEqual(['협상', '주사위']);
        expect(body.categories).toEqual(['Negotiation']);
        // Jev에는 게임 공개 정보만 간다
        const sent = JSON.parse(fetch.mock.calls[1][1].body);
        expect(sent.state).toEqual({ game: { korean_name: '카탄', bgg: expect.objectContaining({ primary: 'CATAN', mechanics: ['Dice Rolling'] }) } });
        expect(fetch.mock.calls[1][1].headers['User-Agent']).toMatch(/^dullgrental\//);
    });
});

describe('jevGenres 모듈', () => {
    it('BGG XML에서 카테고리·메커니즘·인원·난이도를 뽑는다', () => {
        expect(parseBggThings(bggXml)['13']).toMatchObject({ type: 'boardgame', primary: 'CATAN', players: '3-4', minutes: '60-120', weight: '2.28' });
    });

    it('시간초과는 timeout으로 분류하고 throw하지 않는다', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' })));
        expect(await scoreGenres({ koreanName: 'x', bgg: {} }, { apiKey: 'k' })).toEqual({ available: false, reason: 'timeout' });
    });

    it('후보는 최대 4개', () => {
        const scores = GENRE_KEYS.map(genre => ({ genre, p: 0.9 }));
        expect(pickSuggestions(scores)).toHaveLength(4);
    });
});
