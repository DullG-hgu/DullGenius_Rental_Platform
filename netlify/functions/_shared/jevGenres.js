// Jev(TypeSafe 판정 API)로 게임의 정규 장르 후보를 매긴다.
//
// 폴백 원칙: 이 모듈은 관리자 작성 시점에만 쓴다. 홈·검색·키오스크 같은 사용자 경로는
// 절대 부르지 않는다. 키 없음·잔액 0·한도·장애·시간초과는 모두 { available: false }로
// 돌려주고, 화면은 제안 칩만 숨긴 채 수동 입력으로 계속 동작한다 (구독 해지 대비).
//
// 결과는 제안일 뿐이다. 2026-09-27 실측(20게임)에서 운영자 장르 recall@3 32/37이었고,
// 테마를 장르로 착각하는 고확신 오답이 있었다 → 자동 적용 금지, 운영자가 고른다.

const JEV_URL = 'https://jev-ai.pro/api/v1/systemone';
const JEV_MODEL = 'jev-1.13.0';
const USER_AGENT = 'dullgrental/1.0 (+https://dullgrental.netlify.app)';

// 정규 장르 목록 — 운영자가 손질하는 값이므로 여기만 고치면 함수·리포트 스크립트가 함께 바뀐다.
// 설명은 영어가 Jev의 주 언어라 영어로 둔다.
const CANONICAL_GENRES = {
    전략: 'Strategic game with meaningful long-term planning and decisions.',
    파티: 'Light social party game for larger groups, laughter-oriented.',
    카드: 'Played mainly with a deck of cards.',
    블러핑: 'Bluffing or lying is a core mechanic.',
    마피아: 'Hidden roles / social deduction with teams (werewolf or mafia style).',
    추리: 'Deduction: players logically infer hidden information.',
    협력: 'Fully cooperative: players win or lose together against the game.',
    주사위: 'Dice rolling is central to play.',
    퍼즐: 'Puzzle-solving or pattern recognition is central.',
    순발력: 'Real-time speed or reflexes matter.',
    협상: 'Trading and negotiation between players is central.',
    자원관리: 'Collecting and spending resources, economic engine.',
    일꾼배치: 'Worker placement: players place pieces to claim actions.',
    셋컬렉션: 'Collecting sets of matching items for points.',
    덱빌딩: 'Deck-building: players improve their own deck during play.',
    타일놓기: 'Placing tiles to build a map or pattern.',
    레이싱: 'Racing, or betting on a race.',
    퀴즈: 'Trivia or quiz questions.',
    단어: 'Word or language play (guessing words, clues, spelling).',
    방탈출: 'Escape-room style puzzle game.',
    머더미스터리: 'Murder mystery role-play scenario.',
    어드벤처: 'Story-driven adventure or exploration.',
    호러: 'Horror is the central theme and atmosphere, not merely a monster in the art.',
    숫자: 'Manipulating or ordering numbers is the core of play.',
};
const GENRE_KEYS = Object.keys(CANONICAL_GENRES);

const QUESTIONS = Object.fromEntries(GENRE_KEYS.map((genre, index) => [`g${index}`, {
    type: 'noul',
    instructions: `Judge by how the game is played, not by its artwork. Does this board game belong to the genre: ${CANONICAL_GENRES[genre]}`,
    criteria: {
        yes: 'The genre is a defining characteristic a player would use to describe this game.',
        no: 'The genre is absent or only incidental.',
    },
}]));

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");

// BGG thing XML → { [id]: { type, primary, categories, mechanics, players, minutes, weight } }
const parseBggThings = (xml) => {
    const items = {};
    for (const match of xml.matchAll(/<item[^>]*type="([a-z]+)"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g)) {
        const [, type, id, inner] = match;
        const links = (kind) => [...inner.matchAll(new RegExp(`<link type="${kind}" id="\\d+" value="([^"]+)"`, 'g'))].map(m => decode(m[1]));
        const value = (tag) => inner.match(new RegExp(`<${tag} value="([^"]*)"`))?.[1];
        items[id] = {
            type,
            primary: decode(inner.match(/<name type="primary"[^>]*value="([^"]+)"/)?.[1] || ''),
            categories: links('boardgamecategory'),
            mechanics: links('boardgamemechanic'),
            players: `${value('minplayers')}-${value('maxplayers')}`,
            minutes: `${value('minplaytime')}-${value('maxplaytime')}`,
            weight: value('averageweight'),
        };
    }
    return items;
};

// 최대 20개 id를 한 번에 조회한다 (BGG thing API 한도).
const fetchBggThings = async (ids, { token, timeoutMs = 5000 } = {}) => {
    if (!token) throw Object.assign(new Error('BGG_API_TOKEN is not configured'), { reason: 'unconfigured' });
    const response = await fetch(`https://boardgamegeek.com/xmlapi2/thing?id=${ids.join(',')}&stats=1`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw Object.assign(new Error(`BGG ${response.status}`), { reason: 'bgg_unavailable' });
    return parseBggThings(await response.text());
};

const REASON_BY_STATUS = { 401: 'unconfigured', 402: 'quota', 422: 'invalid_request', 429: 'rate_limited' };

// 한 게임의 장르 확률. 실패는 throw하지 않고 { available: false, reason }.
const scoreGenres = async ({ koreanName, bgg }, { apiKey, timeoutMs = 6000 } = {}) => {
    if (!apiKey) return { available: false, reason: 'unconfigured' };
    let response;
    try {
        response = await fetch(JEV_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify({ model: JEV_MODEL, state: { game: { korean_name: koreanName || '', bgg } }, questions: QUESTIONS }),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        return { available: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'upstream' };
    }
    if (!response.ok) return { available: false, reason: REASON_BY_STATUS[response.status] || 'upstream', status: response.status };
    const data = await response.json().catch(() => null);
    const answers = data?.answers;
    if (!answers) return { available: false, reason: 'upstream' };
    const scores = GENRE_KEYS
        .map((genre, index) => ({ genre, p: Number(answers[`g${index}`]?.noul) }))
        .filter(s => Number.isFinite(s.p))
        .sort((a, b) => b.p - a.p);
    return { available: true, model: data.model, scores, inputTokens: data.usage?.input_tokens ?? null };
};

// 화면에 보일 후보: 0.5 이상, 최대 4개.
const pickSuggestions = (scores, { threshold = 0.5, limit = 4 } = {}) =>
    scores.filter(s => s.p >= threshold).slice(0, limit);

module.exports = {
    CANONICAL_GENRES, GENRE_KEYS, USER_AGENT,
    parseBggThings, fetchBggThings, scoreGenres, pickSuggestions,
};
