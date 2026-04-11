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
    // 주의: 환경변수는 Netlify Dashboard → Site settings → Environment variables에서 설정
    // 반드시 다음 이름으로 설정: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Environment variables not set: NAVER_CLIENT_ID and/or NAVER_CLIENT_SECRET' }),
        };
    }

    try {
        const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=10`;

        // node-fetch v2 사용 (CommonJS 호환)
        const response = await fetch(url, {
            headers: {
                'X-Naver-Client-Id': clientId,
                'X-Naver-Client-Secret': clientSecret,
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
