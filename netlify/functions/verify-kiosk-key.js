exports.handler = async function (event) {
    // CORS Preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
            },
            body: '',
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ success: false }) };
    }

    // 1초 지연 — brute force 속도 저하
    await new Promise((resolve) => setTimeout(resolve, 1000));

    let key;
    try {
        ({ key } = JSON.parse(event.body || '{}'));
    } catch {
        return { statusCode: 400, body: JSON.stringify({ success: false }) };
    }

    const masterKey = process.env.KIOSK_MASTER_KEY;
    if (!masterKey) {
        console.error('KIOSK_MASTER_KEY 환경 변수가 설정되지 않았습니다.');
        return { statusCode: 500, body: JSON.stringify({ success: false }) };
    }

    const success = typeof key === 'string' && key === masterKey;

    return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success }),
    };
};
