// src/hooks/useGameFilter.js
// Custom Hook: 게임 필터링 로직 통합 (App.js, DashboardTab.js 중복 제거)

import { useMemo } from 'react';

export const useGameFilter = (games, filters) => {
    const {
        searchTerm = "",
        selectedCategory = "전체",
        difficultyFilter = "전체",
        playerFilter = "all",
        onlyAvailable = false,
        renterFilter = "" // [Admin 전용]
    } = filters;

    // 인원수 체크 헬퍼 함수
    const checkPlayerCount = (minPlayers, maxPlayers, targetFilter) => {
        if (minPlayers == null || maxPlayers == null) return false;
        if (targetFilter === "6+") return maxPlayers >= 6;
        if (targetFilter === "8+") return maxPlayers >= 8;
        const target = parseInt(targetFilter);
        return target >= minPlayers && target <= maxPlayers;
    };

    const filteredGames = useMemo(() => {
        if (!Array.isArray(games)) return []; // [FIX] 안전장치 추가

        return games.filter(game => {
            // 이름 필터 (빈 게임 제외)
            if (!game.name || game.name.trim() === "") return false;

            // TRPG는 선택한 경우에만 표시
            if (selectedCategory !== "TRPG" && game.category === "TRPG") return false;

            // [Professional Search Improvements]
            // 1. 공백 제거 및 대소문자 정규화
            const normalize = (str) => str.replace(/\s+/g, "").toLowerCase();
            const normalizedSearch = normalize(searchTerm);
            const normalizedGameName = normalize(game.name || "");

            // 2. 한글 초성 추출 함수
            const getChoseong = (str) => {
                const choseong = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
                let result = "";
                for (let i = 0; i < str.length; i++) {
                    const code = str.charCodeAt(i) - 0xac00;
                    if (code > -1 && code < 11172) result += choseong[Math.floor(code / 588)];
                    else result += str.charAt(i);
                }
                return result;
            };

            // 3. 순수 초성 여부 확인 함수
            const isPureChoseong = (str) => /^[ㄱ-ㅎ]+$/.test(str);

            // 검색어 필터 (#태그 or 이름)
            if (searchTerm.startsWith("#")) {
                if (!game.tags) return false;

                // [Improved] 태그 검색 로직 강화
                const searchKeyword = searchTerm.replace(/^#/, '');
                const normalizedTagSearch = normalize(searchKeyword);

                let tags = [];
                if (Array.isArray(game.tags)) {
                    tags = game.tags;
                } else if (typeof game.tags === 'string') {
                    tags = game.tags.split(/\s+/).filter(Boolean);
                }

                // 태그 중 하나라도 키워드를 포함하면 매칭 (공백 무시 적용)
                return tags.some(tag => {
                    const normalizedTag = normalize(tag.replace(/^#/, ''));
                    if (normalizedTag.includes(normalizedTagSearch)) return true;
                    if (isPureChoseong(normalizedTagSearch)) {
                        return getChoseong(normalizedTag).includes(normalizedTagSearch);
                    }
                    return false;
                });
            } else {
                if (searchTerm) {
                    // 1. 일반 검색 (공백 무시)
                    if (normalizedGameName.includes(normalizedSearch)) return true;

                    // 2. 한글 초성 검색 (검색어가 순수 초성으로만 이루어진 경우만!)
                    if (isPureChoseong(normalizedSearch)) {
                        const gameChoseong = getChoseong(normalizedGameName);
                        if (gameChoseong.includes(normalizedSearch)) return true;
                    }

                    return false;
                }
            }

            // [Admin 전용] 대여자 필터 (개선 적용)
            if (renterFilter) {
                if (!game.renter) return false;
                const normalizedRenterSearch = normalize(renterFilter);
                const normalizedRenterName = normalize(game.renter);

                // 일반 검색
                if (normalizedRenterName.includes(normalizedRenterSearch)) return true;

                // 초성 검색 (순수 초성일 때만)
                if (isPureChoseong(normalizedRenterSearch)) {
                    const renterChoseong = getChoseong(normalizedRenterName);
                    if (renterChoseong.includes(normalizedRenterSearch)) return true;
                }

                return false;
            }

            // 카테고리 필터
            if (selectedCategory !== "전체" && game.category !== selectedCategory) return false;

            // 상태 필터 (대여 가능만)
            if (onlyAvailable && game.status !== "대여가능") return false;

            // 난이도 필터
            if (difficultyFilter !== "전체" && game.difficulty) {
                const score = parseFloat(game.difficulty);
                if (difficultyFilter === "입문" && score >= 2.0) return false;
                if (difficultyFilter === "초중급" && (score < 2.0 || score >= 3.0)) return false;
                if (difficultyFilter === "전략" && score < 3.0) return false;
            }

            // 인원수 필터
            if (playerFilter !== "all" && (game.min_players != null || game.max_players != null)) {
                if (!checkPlayerCount(game.min_players, game.max_players, playerFilter)) return false;
            }

            return true;
        }).sort((a, b) => {
            // [FIX] 옵션에 따라 정렬 방식 결정
            if (filters.sortByName === false) return 0; // 정렬 안 함 (원본 순서 유지)
            return a.name.localeCompare(b.name, 'ko');
        });
    }, [games, searchTerm, selectedCategory, onlyAvailable, difficultyFilter, playerFilter, renterFilter, filters.sortByName]);

    return filteredGames;
};
