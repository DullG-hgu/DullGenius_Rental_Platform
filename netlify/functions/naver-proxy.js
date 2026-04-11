const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    // 1. CORS Preflight 처리 (선택)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
            body: '',
        };
    }

    // 2. Query Parameter 추출
    const { query } = event.queryStringParameters;
    if (!query) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Query parameter is required' }),
        };
    }

    // 3. Naver API 호출
    // 주의: 환경변수(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)는 Netlify Dashboard에서 설정해야 함
    try {
        const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=10`;

        // node-fetch v2 사용 (CommonJS 호환)
        const response = await fetch(url, {
            headers: {
                'X-Naver-Client-Id': process.env.REACT_APP_NAVER_CLIENT_ID || process.env.NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': process.env.REACT_APP_NAVER_CLIENT_SECRET || process.env.NAVER_CLIENT_SECRET,
            },
        });

        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `Naver API Error: ${response.statusText}` }),
            };
        }

        const data = await response.json();

        // 4. 응답 반환
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' }, // CORS 허용
            body: JSON.stringify(data),
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
