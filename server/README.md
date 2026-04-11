# Google Apps Script Server

이 디렉토리는 덜지니어스 대여소(DullG BoardGameRent)의 백엔드 로직을 담당하는 Google Apps Script(GAS) 코드와 데이터베이스(Google Sheets) 구조를 설명합니다.

## 📂 파일 구조

- **`main.gs`**: 웹 앱의 엔트리 포인트 (`doGet`, `doPost`). 라우팅을 담당합니다.
- **`GameService.gs`**: 게임 목록 조회, 추가, 수정, BGG/네이버 검색 연동 등 게임 관련 비즈니스 로직.
- **`AdminService.gs`**: 관리자 기능, 대여/반납 일괄 처리, 통계 및 로그 관리.
- **`MemberService.gs`**: 회원가입, 로그인, 마이페이지(대여 이력) 관리.
- **`Utils.gs`**: 공통 유틸리티, 시트 접근(Helper), 응답 포맷팅, 상수를 관리합니다.

## 🗄️ 데이터베이스 스키마 (Google Sheets)

이 프로젝트는 별도의 DB 없이 구글 스프레드시트를 데이터베이스로 사용합니다. 시트별 컬럼 구조는 다음과 같습니다.

### 1. Games (게임 목록)
게임의 메타 데이터와 현재 상태를 관리합니다.

| Column Index | Header (Key) | Description | Note |
|:---:|---|---|---|
| A | `id` | 게임 고유 ID | PK |
| B | `name` | 게임 이름 | |
| C | `category` | 카테고리 | |
| D | `image` | 이미지 URL | |
| E | `naver_id` | 네이버 쇼핑 ID | |
| F | `bgg_id` | BGG ID | |
| G | `status` | 대여 상태 | 대여가능, 대여중, 찜, 분실 등 |
| H | `difficulty` | 난이도 | 1.0~5.0 |
| I | `genre` | 장르 | |
| J | `players` | 인원 수 | 예: "2~4명" |
| K | `best` | 최적 인원 | 예: 4, 3-4 |
| L | `tags` | 검색 태그 | #해시태그 |
| M | `renter` | 대여자 | |
| N | `renter_id` | **대여자ID** | 학번 (찜/대여 시 저장) |
| O | `due_date` | 반납일 | |
| P | `condition` | 상태 | 현재 이용중이지 않음. 이후 수리/등 주석으로 활용|
| P | `total_rentals` | 대여 횟수 | 통계 |
| Q | `dibs_count` | 누적 찜 횟수 | 통계 |
| R | `total_views` | 누적 조회수 | 통계 |
| S | `avg_rating` | 평균 평점 | 통계 |
| T | `review_count`| 리뷰 개수 | 통계 |

### 2. Rentals (대여 현황)
현재 대여 중인 내역을 관리합니다. (반납 시 삭제됨)

| Column Index | Header (Key) | Description |
|:---:|---|---|
| A | `rental_id` | 대여 고유 ID |
| B | `user_id` | 학번 |
| C | `game_id` | 게임 ID |
| D | `game_name` | 게임 이름 |
| E | `borrowed_at`| 대여 일시 |
| F | `due_date` | 반납 예정일 |

### 3. Users (회원 정보)
부원(회원) 정보를 관리합니다.

| Column Index | Header (Key) | Description |
|:---:|---|---|
| A | `name` | 이름 |
| B | `student_id` | 학번 |
| C | `password` | 비밀번호 |
| D | `phone` | 전화번호 |
| E | `is_paid` | 회비 납부 여부 |
| F | `penalty` | 벌금 |
| G | `last_login` | 마지막 접속일 |
| H | `role` | 권한 (member/admin) |



### 4. Logs (전체 로그)
대여, 반납, 찜, 상태 변경 등 모든 액션을 기록합니다.

| Column Index | Header (Key) | Description |
|:---:|---|---|
| A | `log_id` | 로그 ID |
| B | `game_id` | 게임 ID |
| C | `action_type`| 액션 타입 | RENT, RETURN, MISS, VIEW 등 |
| D | `value` | 상세 값 | rental_id 참조 등 |
| E | `timestamp` | 기록 시간 |
| F | `user_id` | 수행 유저 ID |

### 5. Reviews (리뷰)
사용자 리뷰 데이터입니다.

| Column Index | Header (Key) | Description |
|:---:|---|---|
| A | `id` | 리뷰 ID (rev_...) |
| B | `game_id` | 게임 ID |
| C | `user_name` | 작성자 이름 |
| D | `password` | 비밀번호 (삭제용) |
| E | `rating` | 평점 (1~5) |
| F | `comment` | 한줄평 |
| G | `date` | 작성일 |

### 6. Config (설정)
메인 화면의 '상황별 추천' 버튼 등을 관리합니다.
- `key`, `label`, `value`, `color`

## 🚀 배포 방법

1. `clasp`를 사용하거나 Google Apps Script 에디터에 위 파일들을 복사하여 넣습니다.
2. `Utils.gs`의 상단 `SHEET_NAMES` 및 API Key 설정을 확인합니다.
3. **배포 > 새 배포 > 종류: 웹 앱**을 선택합니다.
   - 엑세스 권한: **"모든 사용자"** (프론트엔드에서 CORS 없이 접근하기 위함)
4. 배포된 `Current web app URL`을 프론트엔드의 `api.js` (`API_BASE_URL`)에 적용합니다.
