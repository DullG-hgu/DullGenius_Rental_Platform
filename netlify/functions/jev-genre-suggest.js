// 관리자 게임 폼의 「AI 장르 제안」. GET ?bgg_id=123&name=카탄
//
// 필요한 env (전부 서버 전용, VITE_ 금지):
//   JEV_AI_API_KEY   Jev API 키. 없거나 잔액이 0이면 제안만 꺼지고 폼은 그대로 동작한다
//   BGG_API_TOKEN    BGG 카테고리·메커니즘 조회
//
// Jev 쪽 실패(키 없음·402·429·장애·시간초과)는 200 + { available: false, reason }으로 돌려준다.
// 화면은 이 응답을 오류로 띄우지 않고 제안 영역만 숨긴다.
// 시간 예산: BGG 4초 + Jev 5초 < Netlify 함수 한도 10초.
const { authorizeAdmin } = require('./_shared/authorizeAdmin');
const { fetchBggThings, scoreGenres, pickSuggestions } = require('./_shared/jevGenres');

const JSON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
};
const json = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });

exports.handler = async function (event) {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: { ...JSON_HEADERS, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
            body: '',
        };
    }
    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

    const bggId = event.queryStringParameters?.bgg_id?.trim();
    const name = (event.queryStringParameters?.name || '').trim().slice(0, 100);
    if (!/^\d{1,9}$/.test(bggId || '')) return json(400, { error: 'bgg_id must be numeric' });

    const authError = await authorizeAdmin(event);
    if (authError) return json(authError.statusCode, { error: authError.error });

    if (!process.env.JEV_AI_API_KEY) return json(200, { available: false, reason: 'unconfigured' });

    let bgg;
    try {
        bgg = (await fetchBggThings([bggId], { token: process.env.BGG_API_TOKEN, timeoutMs: 4000 }))[bggId];
    } catch (error) {
        return json(200, { available: false, reason: error.reason || 'bgg_unavailable' });
    }
    if (!bgg) return json(200, { available: false, reason: 'bgg_not_found' });

    const result = await scoreGenres({ koreanName: name, bgg }, { apiKey: process.env.JEV_AI_API_KEY, timeoutMs: 5000 });
    if (!result.available) {
        // 잔액·키 문제는 운영자가 알아야 하므로 서버 로그에 남긴다 (키 값은 남기지 않는다).
        console.error('jev-genre-suggest: unavailable', { reason: result.reason, status: result.status });
        return json(200, { available: false, reason: result.reason });
    }
    return json(200, {
        available: true,
        model: result.model,
        suggestions: pickSuggestions(result.scores),
        categories: bgg.categories,
    });
};
