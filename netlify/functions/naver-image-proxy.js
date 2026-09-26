const { authorizeAdmin } = require('./_shared/authorizeAdmin');

const JSON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
};

const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
});

exports.handler = async function (event) {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                ...JSON_HEADERS,
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
            body: '',
        };
    }

    if (event.httpMethod !== 'GET') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    const query = event.queryStringParameters?.query?.trim();
    if (!query) {
        return jsonResponse(400, { error: 'query parameter is required' });
    }

    const authError = await authorizeAdmin(event);
    if (authError) return jsonResponse(authError.statusCode, { error: authError.error });

    const clientId = process.env.NAVER_API_HUB_CLIENT_ID;
    const clientSecret = process.env.NAVER_API_HUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return jsonResponse(500, {
            error: 'NAVER_API_HUB_CLIENT_ID and NAVER_API_HUB_CLIENT_SECRET must be configured',
        });
    }

    const params = new URLSearchParams({
        query,
        display: '10',
        start: '1',
        sort: 'sim',
        filter: 'large',
        format: 'json',
    });

    try {
        const response = await fetch(
            `https://naverapihub.apigw.ntruss.com/search/v1/image?${params}`,
            {
                headers: {
                    'X-NCP-APIGW-API-KEY-ID': clientId,
                    'X-NCP-APIGW-API-KEY': clientSecret,
                },
            },
        );

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            console.error('NAVER API HUB image search failed:', response.status, payload?.errorCode || payload?.error?.errorCode);
            return jsonResponse(response.status, {
                error: payload?.errorMessage || payload?.error?.message || `Image search failed (${response.status})`,
            });
        }

        const items = Array.isArray(payload?.items)
            ? payload.items
                .filter((item) => item?.link && item?.thumbnail)
                .map((item) => ({
                    title: item.title || '',
                    image: item.link,
                    thumbnail: item.thumbnail,
                    width: Number(item.sizewidth) || null,
                    height: Number(item.sizeheight) || null,
                }))
            : [];

        return jsonResponse(200, { items });
    } catch (error) {
        console.error('NAVER API HUB image search request failed:', error);
        return jsonResponse(502, { error: 'Image search service is temporarily unavailable' });
    }
};
