exports.handler = async function (event, context) {
    // 1. CORS Preflight 처리
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
    const { action, query, id } = event.queryStringParameters || {};

    if (!action) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'action parameter is required (search or detail)' }),
        };
    }

    // 3. BGG API 호출
    let bggUrl;
    if (action === 'search') {
        if (!query) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'query parameter is required for search action' }),
            };
        }
        bggUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame`;
    } else if (action === 'detail') {
        if (!id) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'id parameter is required for detail action' }),
            };
        }
        bggUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${id}&stats=1`;
    } else {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'action must be search or detail' }),
        };
    }

    try {
        // BGG API Token 확인
        const bggToken = process.env.BGG_API_TOKEN;
        if (!bggToken) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'BGG_API_TOKEN environment variable not set' }),
            };
        }

        // 202 Retry 루프 (최대 3회, 1초 간격)
        let response;
        let attempts = 0;
        while (attempts < 3) {
            response = await fetch(bggUrl, {
                headers: {
                    'Authorization': `Bearer ${bggToken}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/xml, text/xml, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            if (response.status !== 202) break;
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
        }

        if (response.status === 202) {
            return {
                statusCode: 202,
                body: JSON.stringify({ error: 'BGG 서버가 준비중입니다. 잠시 후 다시 시도해주세요.' }),
            };
        }

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`BGG API Error ${response.status}:`, errorBody.substring(0, 500));
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `BGG API Error: ${response.statusText} (${response.status})` }),
            };
        }

        const xmlText = await response.text();

        // XML 파싱 후 JSON 변환
        let responseData;
        if (action === 'search') {
            responseData = { items: parseSearchXml(xmlText) };
        } else {
            responseData = parseDetailXml(xmlText);
        }

        // 4. 응답 반환
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(responseData),
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

// XML 파싱 함수 (검색 결과)
function parseSearchXml(xml) {
    const items = [];
    const itemRegex = /<item[^>]*type="boardgame"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
        const id = match[1];
        const inner = match[2];
        // primary 이름을 먼저 찾고, 없으면 alternate 이름 사용 (다국어 지원)
        let nameMatch = inner.match(/<name[^>]*type="primary"[^>]*value="([^"]+)"/);
        if (!nameMatch) {
            nameMatch = inner.match(/<name[^>]*type="alternate"[^>]*value="([^"]+)"/);
        }
        const yearMatch = inner.match(/<yearpublished[^>]*value="([^"]+)"/);
        if (nameMatch) {
            items.push({
                id,
                name: nameMatch[1],
                year: yearMatch ? yearMatch[1] : ''
            });
        }
    }
    return items;
}

// XML 파싱 함수 (상세 정보)
function parseDetailXml(xml) {
    const idMatch = xml.match(/<item[^>]*id="(\d+)"/);
    // primary 이름을 먼저 찾고, 없으면 alternate 이름 사용 (다국어 지원)
    let nameMatch = xml.match(/<name[^>]*type="primary"[^>]*value="([^"]+)"/);
    if (!nameMatch) {
        nameMatch = xml.match(/<name[^>]*type="alternate"[^>]*value="([^"]+)"/);
    }
    const thumbMatch = xml.match(/<thumbnail>(.*?)<\/thumbnail>/);
    const minPMatch = xml.match(/<minplayers[^>]*value="(\d+)"/);
    const maxPMatch = xml.match(/<maxplayers[^>]*value="(\d+)"/);
    const weightMatch = xml.match(/<averageweight[^>]*value="([^"]+)"/);
    const minPlaytimeMatch = xml.match(/<minplaytime[^>]*value="(\d+)"/);
    const maxPlaytimeMatch = xml.match(/<maxplaytime[^>]*value="(\d+)"/);

    let thumbnail = thumbMatch ? thumbMatch[1].trim() : '';
    // thumbnail URL이 protocol 없이 //로 시작하면 https: 붙이기
    if (thumbnail && thumbnail.startsWith('//')) {
        thumbnail = 'https:' + thumbnail;
    }

    // 장르(카테고리) 파싱
    const genres = [];
    const categoryRegex = /<link[^>]*type="boardgamecategory"[^>]*value="([^"]+)"/g;
    let categoryMatch;
    while ((categoryMatch = categoryRegex.exec(xml)) !== null) {
        genres.push(categoryMatch[1]);
    }

    // 메커니즘 파싱
    const mechanics = [];
    const mechanicRegex = /<link[^>]*type="boardgamemechanic"[^>]*value="([^"]+)"/g;
    let mechanicMatch;
    while ((mechanicMatch = mechanicRegex.exec(xml)) !== null) {
        mechanics.push(mechanicMatch[1]);
    }

    return {
        id: idMatch ? idMatch[1] : '',
        name: nameMatch ? nameMatch[1] : '',
        thumbnail: thumbnail,
        minPlayers: minPMatch ? minPMatch[1] : '',
        maxPlayers: maxPMatch ? maxPMatch[1] : '',
        minPlaytime: minPlaytimeMatch ? minPlaytimeMatch[1] : '',
        maxPlaytime: maxPlaytimeMatch ? maxPlaytimeMatch[1] : '',
        weight: weightMatch ? parseFloat(weightMatch[1]).toFixed(2) : '',
        genres: genres,
        mechanics: mechanics
    };
}
