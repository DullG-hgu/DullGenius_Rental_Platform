// src/infoData.js
// 최종 수정일: 2026.02.16
// 설명: 웹사이트 하단 정보 바 및 모달에 표시되는 데이터 관리 파일

import { TEXTS } from './constants';

export const CLUB_INFO = {
    name: "한동대 보드게임 동아리 덜지니어스 (DullGenius)",
    officeHour: "1주차 월~금 18:00 ~ 21:00",
    location: "학관 2층 231호, 동아리방 골목 운동장 방면. "
};

export const CONTACTS = {
    // email: "alexcat5929@handong.ac.kr", // 이전 개인 이메일
    email: "DullGenius.official@gmail.com",
};

export const LINKS = {
    gameRequest: "https://forms.gle/VaASrMoiC6pda75t8", // 게임 신청 구글 폼 (기존 링크 활용)
    recruit: "https://docs.google.com/forms/d/e/1FAIpQLScrbBs5TsTkT0Nkm4HMtkg7STmPkUNjIdlSeiV3dp60Q7wFzQ/viewform?usp=header", // 부원 가입 신청 폼
    orgRentalForm: "https://docs.google.com/forms/d/e/1FAIpQLSfhI5Y62TLi3KLoaIOIIjXHvklMI3RH-OWtTz1y6Xju0ei8kw/viewform", // 단체 대여 신청 구글 폼
};

export const DEVELOPERS = [
    { name: "김범근", role: "Main Developer & 25-2, 26-1 회장" },
    // { name: "Contributer Name", role: "Designer" }
];

// 이용 약관 & 이용 안내: constants.js의 TEXTS 가져오기
export const TERMS_OF_SERVICE = TEXTS.RENTAL_RULE;
export const USAGE_GUIDE = TEXTS.MAIN_GUIDE;
