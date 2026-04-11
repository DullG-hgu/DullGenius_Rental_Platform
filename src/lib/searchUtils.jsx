/**
 * searchUtils.js
 * 재사용 가능한 검색 필터 로직
 */

import { choseongStartsWith } from './hangul';

/**
 * 사용자 배열을 검색어로 필터링
 * - 이름의 일반 매칭
 * - 이름의 초성 매칭
 * - 학번 포함 검색
 * 
 * @param {Array} users - 사용자 배열
 * @param {string} searchTerm - 검색어
 * @returns {Array} 필터링된 사용자 배열
 */
export function filterUsers(users, searchTerm) {
    if (!searchTerm) return users;

    const term = searchTerm.toLowerCase();

    return users.filter(user => {
        // 1. 이름의 일반 매칭
        const nameMatch = user.name.toLowerCase().includes(term);

        // 2. 초성 매칭 (이름의 시작 부분과 매칭)
        const choseongMatch = choseongStartsWith(user.name, term);

        // 3. 학번 포함 검색
        const studentIdMatch = user.student_id && user.student_id.includes(term);

        return nameMatch || choseongMatch || studentIdMatch;
    });
}

/**
 * 게임 배열을 검색어로 필터링
 * - 게임 이름의 일반 매칭
 * - 게임 이름의 초성 매칭
 * - [ALPHA]: 영문으로 시작하는 게임 필터링
 * - [NUMERIC]: 숫자로 시작하는 게임 필터링
 * 
 * @param {Array} games - 게임 배열
 * @param {string} searchTerm - 검색어
 * @returns {Array} 필터링된 게임 배열
 */
export function filterGames(games, searchTerm) {
    if (!searchTerm) return games;

    const term = searchTerm.toLowerCase();

    // 특수 카테고리 키워드 처리
    if (term === '[alpha]') {
        return games.filter(game => {
            const firstChar = game.name.charAt(0);
            return /[a-zA-Z]/.test(firstChar);
        });
    }

    if (term === '[numeric]') {
        return games.filter(game => {
            const firstChar = game.name.charAt(0);
            return /[0-9]/.test(firstChar);
        });
    }

    // 일반 검색
    return games.filter(game => {
        // 1. 게임 이름의 일반 매칭
        const nameMatch = game.name.toLowerCase().includes(term);

        // 2. 초성 매칭 (이름의 시작 부분과 매칭)
        const choseongMatch = choseongStartsWith(game.name, term);

        return nameMatch || choseongMatch;
    });
}
