/**
 * hangul.js
 * 한글 초성 추출 및 매칭을 위한 유틸리티 함수들
 */

// 한글 초성 목록
const CHOSEONG_LIST = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
    'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

/**
 * 한글 문자열에서 초성을 추출
 * @param {string} text - 초성을 추출할 한글 문자열
 * @returns {string} 추출된 초성 문자열
 * 
 * @example
 * getChoseong('할리갈리') // 'ㅎㄹㄱㄹ'
 * getChoseong('김철수') // 'ㄱㅊㅅ'
 */
export function getChoseong(text) {
    if (!text) return '';

    let result = '';
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);

        // 한글 유니코드 범위: 0xAC00 ~ 0xD7A3
        if (code >= 0xAC00 && code <= 0xD7A3) {
            // 초성 계산: (전체 코드 - 0xAC00) / 588
            const choseongIndex = Math.floor((code - 0xAC00) / 588);
            result += CHOSEONG_LIST[choseongIndex];
        } else if (CHOSEONG_LIST.includes(text[i])) {
            // 이미 초성인 경우 그대로 추가
            result += text[i];
        } else if (text[i] === ' ') {
            // 띄어쓰기는 무시 (검색 편의성 향상)
            continue;
        } else {
            // 한글이 아닌 경우 그대로 추가 (영문, 숫자 등)
            result += text[i];
        }
    }

    return result;
}

/**
 * 대상 문자열이 쿼리 문자열의 초성으로 시작하는지 확인
 * @param {string} target - 검색 대상 문자열
 * @param {string} query - 검색 쿼리 문자열
 * @returns {boolean} 매칭 여부
 * 
 * @example
 * choseongStartsWith('할리갈리', 'ㅎ') // true
 * choseongStartsWith('할리갈리', 'ㅎㄹ') // true
 * choseongStartsWith('글룸헤이븐', 'ㄱ') // true
 * choseongStartsWith('할리갈리', 'ㄱ') // false
 */
export function choseongStartsWith(target, query) {
    if (!target || !query) return true;

    const targetChoseong = getChoseong(target.toLowerCase());
    const queryChoseong = getChoseong(query.toLowerCase());

    return targetChoseong.startsWith(queryChoseong);
}

/**
 * 하위 호환성을 위한 별칭 (기존 코드에서 사용 중일 수 있음)
 * @deprecated Use choseongStartsWith instead for better semantics
 */
export function choseongIncludes(target, query) {
    return choseongStartsWith(target, query);
}
