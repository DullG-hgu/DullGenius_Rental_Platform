/**
 * BGG 카테고리 → 한국어 매핑
 * 빈도 분석 결과를 바탕으로 작성됨 (2026-04-16)
 */

export const GENRE_MAP = {
  // 상위 10개 (자주 나오는 것들)
  'Card Game': '카드 게임',
  'Fantasy': '판타지',
  'Deduction': '추리',
  'Party Game': '파티 게임',
  'Bluffing': '블러핑',
  'Economic': '경제',
  'Exploration': '탐험',
  'Negotiation': '협상',
  'Adventure': '모험',
  'Expansion for Base-game': '확장판',

  // 8회
  'Territory Building': '영토 확장',
  'Animals': '동물',

  // 7회
  'Science Fiction': 'SF',
  'Humor': '유머',
  'Medieval': '중세',
  'Fighting': '전투',

  // 6회
  'Novel-based': '소설 원작',
  'Abstract Strategy': '추상 전략',
  'Puzzle': '퍼즐',
  'Spies / Secret Agents': '스파이',

  // 5회
  'Civilization': '문명',
  "Children's Game": '어린이 게임',
  'Real-time': '실시간',
  'Political': '정치',
  'Dice': '주사위',
  'Wargame': '워게임',
  'Renaissance': '르네상스',

  // 4회 이상 기타
  'City Building': '도시 건설',
  'Horror': '공포',
  'Educational': '교육용',

  // 빈도 낮지만 알려진 것들
  'Worker Placement': '워커 플레이스먼트',
  'Racing': '레이싱',
  'Sports': '스포츠',
  'Music': '음악',
  'Movies / TV / Radio Theme': '영화/TV 원작',
  'Mythology': '신화',
  'Space Exploration': '우주 탐험',
  'Time Travel': '시간 여행',
  'Auction': '경매',
  'Memory': '메모리',
  'Pattern Building': '패턴 건설',
  'Tile Placement': '타일 배치',
  'Print and Play': '프린트 앤 플레이',
  'Trains': '기차',
  'Video Game Theme': '비디오 게임 원작',
};

/**
 * 영어 장르명을 한국어로 변환
 * @param {string} engGenre - 영어 장르명
 * @returns {string} 한국어 장르명 (매핑 없으면 원본 반환)
 */
export const translateGenre = (engGenre) => {
  if (!engGenre) return '';
  // HTML entity 처리 (예: Children&#039;s Game → Children's Game)
  const decoded = engGenre.replace(/&#039;/g, "'");
  return GENRE_MAP[decoded] || decoded;
};

/**
 * 장르 배열을 한국어로 변환
 * @param {string[]} genres - 영어 장르 배열
 * @returns {string[]} 한국어 장르 배열
 */
export const translateGenres = (genres) => {
  if (!Array.isArray(genres)) return [];
  return genres.map(translateGenre);
};
