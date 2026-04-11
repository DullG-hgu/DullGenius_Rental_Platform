// server/GameService.gs
// Logic related to board game data (fetching, filtering, etc.)

/* GameService.gs */

// 1. 게임 목록 조회
function getGamesList() {
  return responseJSON(getData(SHEET_NAMES.GAMES));
}

// 2. 게임 추가 (장르, BGG 연동 포함)
// [Refactor] 헤더를 읽어서 동적으로 매핑 (컬럼 순서 변경 대응)
function addNewGame(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gameSheet = ss.getSheetByName(SHEET_NAMES.GAMES);
  
  // 헤더 로드
  const headers = gameSheet.getDataRange().getValues()[0];
  const newRow = new Array(headers.length).fill(""); // 빈 행 생성

  // BGG 데이터 로드
  let diff = "", gen = "";
  if (payload.bgg_id) {
    const bggData = fetchBggDataSafe(payload.bgg_id);
    if (bggData) {
      diff = bggData.difficulty;
      gen = bggData.genre;
    }
  }
  const finalGenre = payload.genre || gen;

  // 컬럼 매핑 헬퍼
  const setVal = (key, val) => {
    const idx = headers.indexOf(key);
    if (idx !== -1) newRow[idx] = val;
  };

  // 데이터 채우기 (헤더 이름 기준)
  setVal("id", payload.id);
  setVal("name", payload.name);
  setVal("category", payload.category);
  setVal("image", payload.image);
  setVal("naver_id", payload.naver_id);
  setVal("bgg_id", payload.bgg_id);
  
  setVal("status", "대여가능");
  setVal("difficulty", payload.difficulty || diff);
  setVal("genre", finalGenre);
  setVal("players", payload.players || "");
  setVal("tags", payload.tags || "");
  
  // 초기값 0 설정 (순서 무관하게 이름으로 찾음)
  setVal("total_views", 0);
  setVal("dibs_count", 0);
  setVal("review_count", 0);
  setVal("avg_rating", 0);
  
  // 명시적 빈값 (필수는 아님, fill("")로 처리됨)
  // setVal("renter", ""); 
  // setVal("due_date", "");
  // setVal("renter_id", ""); 

  gameSheet.appendRow(newRow);
  return responseJSON({ status: "success" });
}

// 3. 게임 정보 수정 (전체 필드 + 장르 포함)
function editGameInfo(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.GAMES);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  
  const col = {
    id: headers.indexOf("id"),
    name: headers.indexOf("name"),
    category: headers.indexOf("category"),
    image: headers.indexOf("image"),
    difficulty: headers.indexOf("difficulty"),
    genre: headers.indexOf("genre"),    // 장르 컬럼
    players: headers.indexOf("players"),
    tags: headers.indexOf("tags")
  };

  if (col.id === -1) return responseJSON({ status: "error", message: "ID Header Not Found" });

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][col.id]) === String(payload.game_id)) {
      const rowNum = i + 1;
      
      if (payload.name) sheet.getRange(rowNum, col.name + 1).setValue(payload.name);
      if (payload.category) sheet.getRange(rowNum, col.category + 1).setValue(payload.category);
      if (payload.image) sheet.getRange(rowNum, col.image + 1).setValue(payload.image);
      if (payload.difficulty !== undefined) sheet.getRange(rowNum, col.difficulty + 1).setValue(payload.difficulty);
      if (payload.players) sheet.getRange(rowNum, col.players + 1).setValue(payload.players);
      if (payload.tags !== undefined) sheet.getRange(rowNum, col.tags + 1).setValue(payload.tags);
      
      // 장르 업데이트
      if (payload.genre !== undefined && col.genre !== -1) {
        sheet.getRange(rowNum, col.genre + 1).setValue(payload.genre);
      }
      
      return responseJSON({ status: "success" });
    }
  }
  return responseJSON({ status: "error", message: "Game Not Found" });
}

// 4. 게임 찜하기
function rentGameDibs(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gameSheet = ss.getSheetByName(SHEET_NAMES.GAMES);
  
  updateGameStatusSafe(gameSheet, payload.game_id, "찜", payload.renter, payload.due_date);
  incrementStatSafe(gameSheet, payload.game_id, "dibs_count");
  logAction(ss.getSheetByName(SHEET_NAMES.LOGS), payload.game_id, "DIBS", payload.player_count, payload.renter);
  
  return responseJSON({ status: "success" });
}

// 4.1, 회원 검증이 포함된 게임 찜하기
function handleGameRent(params) {
  // 1. [검증] 회원 여부 및 비밀번호 확인
  const userSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Users");
  
  if (!userSheet) return responseJSON({ result: "error", message: "Users 시트가 없습니다." });

  const targetId = String(params.student_id);
  const targetPw = String(params.password || "");

  // [Secure] MemberService의 인증 로직 사용 (해시 검증 지원)
  const authResult = MemberService._authenticate(userSheet, targetId, targetPw);

  // 2. [예외 처리] 검증 실패 시 즉시 리턴
  if (!authResult.success) {
     return responseJSON({ result: "error", message: "학번 또는 비밀번호가 일치하지 않습니다." });
  }

  const memberName = authResult.row[0]; // 이름 가져오기

  // 3. [실행] 검증 통과 후, "찜" 상태로 업데이트 (Rentals 시트 기록 X)
  // ---------------------------------------------------------
  
  // 파라미터에서 게임 정보 가져오기
  const gameId = params.game_id;
  const gameName = params.game_name;

  if (!gameId) {
    return responseJSON({ result: "error", message: "게임 정보가 누락되었습니다." });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gameSheet = ss.getSheetByName(SHEET_NAMES.GAMES);
  const logSheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  
  const now = new Date();
  const thirtyMinutesLater = new Date(now.getTime() + 30 * 60 * 1000); // 30분 뒤
  
  // Games 시트 업데이트 (Status="찜", Renter=이름, RenterID=학번)
  // updateGameStatusSafe(sheet, gameId, status, renter, dueDate, renterId)
  updateGameStatusSafe(
    gameSheet, 
    gameId, 
    "찜", 
    memberName,                      // 이름
    thirtyMinutesLater.toISOString(), // 반납 기한 (여기선 찜 만료 시간)
    targetId                         // ⭐ renter_id (학번)
  );

  // [Fix] MyPage 노출을 위해 Rentals 시트에도 기록 추가 (30분 기한)
  // MemberService는 같은 프로젝트 내에 있으므로 호출 가능
  try {
     const rentalsSheet = ss.getSheetByName("Rentals") || ss.insertSheet("Rentals");
     const rentalId = Utilities.getUuid();
     
     // 순서: rental_id | user_id | game_id | game_name | borrowed_at | due_date
     rentalsSheet.appendRow([
       rentalId, 
       targetId,   
       gameId, 
       gameName, 
       now.toISOString(), 
       thirtyMinutesLater.toISOString() 
     ]);
  } catch (e) {
     Logger.log("Rentals update failed: " + e.toString());
  }

  // 로그 남기기
  logAction(logSheet, gameId, "DIBS", "방문 수령 예약", targetId);

  // 4. [완료] 성공 응답
  return responseJSON({ 
    result: "success", 
    message: `${memberName}님, ${gameName} 찜 완료! 30분 내로 수령해주세요.`,
    expireAt: thirtyMinutesLater.toISOString() 
  });
}

// 응답 헬퍼 함수 (없다면 추가)
function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// 5. 입고 요청
function requestRestock(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  logAction(ss.getSheetByName(SHEET_NAMES.LOGS), payload.game_id, "MISS", "입고요청", payload.user_id);
  return responseJSON({ status: "success" });
}

// 6. 조회수 증가
function incrementViewCount(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gameSheet = ss.getSheetByName(SHEET_NAMES.GAMES);
  
  // 조회 시점의 상태(대여가능/대여중/찜)를 가져옴
  const currentStatus = getStatusById(gameSheet, payload.game_id);
  
  incrementStatSafe(gameSheet, payload.game_id, "total_views");
  
  // 로그 Value에 상태를 기록 (예: "VIEW", "대여가능")
  logAction(ss.getSheetByName(SHEET_NAMES.LOGS), payload.game_id, "VIEW", currentStatus, "Anonymous");
  return responseJSON({ status: "success" });
}

// 7. 게임 삭제
function deleteGamePermanently(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.GAMES);
  const rows = sheet.getDataRange().getValues();
  const colId = rows[0].indexOf("id");
  
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][colId]) === String(payload.game_id)) {
      sheet.deleteRow(i + 1);
      return responseJSON({ status: "success" });
    }
  }
  return responseJSON({ status: "error", message: "Not Found" });
}

// 8. 네이버 검색
function searchNaverShop(payload) {
  return responseJSON(searchNaverShopInternal(payload.keyword));
}

// 9. 인기 급상승 조회
function getTrendingGames() {
  return responseJSON(getTrendingGamesInternal(7));
}

// 10. BGG API 조회
function searchBGG(payload) {
  const query = payload.keyword;
  // BGG 검색 API (XML 반환)
  const url = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame`;
  
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      return responseJSON({ status: "error", message: "BGG 서버 응답 오류" });
    }

    const xml = response.getContentText();
    const document = XmlService.parse(xml);
    const items = document.getRootElement().getChildren("item");

    // 상위 5개만 추출
    const results = items.slice(0, 5).map(item => {
      const id = item.getAttribute("id").getValue();
      // 이름이 여러 개일 수 있음 (primary 찾기)
      const names = item.getChildren("name");
      let title = "Unknown";
      names.forEach(n => {
        if (n.getAttribute("type").getValue() === "primary") title = n.getAttribute("value").getValue();
      });
      
      const year = item.getChild("yearpublished") ? item.getChild("yearpublished").getAttribute("value").getValue() : "";

      return {
        id: id,
        title: `${title} (${year})`
      };
    });

    return responseJSON({ status: "success", items: results });

  } catch (e) {
    return responseJSON({ status: "error", message: e.toString() });
  }
}

// 2. BGG 상세 정보 조회 (ID -> 난이도, 인원 등)
function getBGGDetails(payload) {
  const id = payload.bgg_id;
  // stats=1을 넣어야 난이도(averageweight)가 나옴
  const url = `https://boardgamegeek.com/xmlapi2/thing?id=${id}&stats=1`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    
    // ⭐ [핵심] BGG가 "202 Accepted" (처리 중)를 주면, 잠시 대기 후 한 번 더 요청해야 함 (간단히 구현)
    if (response.getResponseCode() === 202) {
       Utilities.sleep(1000); // 1초 대기
       return getBGGDetails(payload); // 재귀 호출 (한 번 더 시도)
    }

    const xml = response.getContentText();
    const document = XmlService.parse(xml);
    const item = document.getRootElement().getChild("item");
    
    if (!item) return responseJSON({ status: "error", message: "정보 없음" });

    // 데이터 파싱 (XML 지옥 탈출)
    const statistics = item.getChild("statistics").getChild("ratings");
    const weight = statistics.getChild("averageweight").getAttribute("value").getValue();
    const minPlayers = item.getChild("minplayers").getAttribute("value").getValue();
    const maxPlayers = item.getChild("maxplayers").getAttribute("value").getValue();
    
    // 장르 추출
    const links = item.getChildren("link");
    const categories = [];
    links.forEach(link => {
      if (link.getAttribute("type").getValue() === "boardgamecategory") {
        categories.push(link.getAttribute("value").getValue());
      }
    });

    return responseJSON({
      status: "success",
      data: {
        difficulty: parseFloat(weight).toFixed(2), // 2.54
        players: `${minPlayers}~${maxPlayers}인`,
        genres: categories.slice(0, 3).join(", ") // 전략, 경제, 문명
      }
    });

  } catch (e) {
    return responseJSON({ status: "error", message: e.toString() });
  }
}