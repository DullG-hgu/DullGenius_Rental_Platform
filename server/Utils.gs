// server/Utils.gs
// Helper functions (date formatting, sheet access, etc.)

// TODO: Paste your Utils.gs code here
/* Utils.gs */

// ⭐ API 설정
const NAVER_CLIENT_ID = "YOUR_NAVER_CLIENT_ID";
const NAVER_CLIENT_SECRET = "YOUR_NAVER_CLIENT_SECRET";
const SHEET_NAMES = { 
  GAMES: "Games", 
  REVIEWS: "Reviews", 
  LOGS: "Logs", 
  CONFIG: "Config", 
  SETTINGS: "Settings",
  USERS: "Users",
  RENTALS: "Rentals"
  };

// 1. JSON 응답 생성
function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// 2. 시트 데이터 읽기 (JSON 배열로 변환)
function getData(name) {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  const v = s.getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v[0], d = [];
  for (let i=1; i<v.length; i++) {
    let r = {}; h.forEach((k, j) => r[k] = v[i][j]); d.push(r);
  }
  return d;
}

// 3. 로그 기록
function logAction(sheet, gid, type, val, uid) { 
  if(sheet) sheet.appendRow(["log_"+Date.now(), gid, type, val, new Date().toLocaleString(), uid]); 
}

// 4. 비밀번호 해싱 (SHA-256)
function hashPassword(password) {
  if (!password) return "";
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  let txtHash = "";
  for (let i = 0; i < rawHash.length; i++) {
    let hashVal = rawHash[i];
    if (hashVal < 0) {
      hashVal += 256;
    }
    if (hashVal.toString(16).length == 1) {
      txtHash += '0';
    }
    txtHash += hashVal.toString(16);
  }
  return txtHash;
}

function updateGameStatusSafe(sheet, gameId, status, renter, dueDate) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).toLowerCase().trim()); // ⭐ 헤더를 모두 소문자로 변환해서 비교
  
  const colId = headers.indexOf("id");
  const colStatus = headers.indexOf("status");
  const colRenter = headers.indexOf("renter");
  const colDue = headers.indexOf("due_date"); // 혹은 "due date"

  // ID나 Status 컬럼이 없으면 에러 로그 남기고 종료
  if (colId === -1 || colStatus === -1) {
    Logger.log("❌ [오류] 'id' 또는 'status' 컬럼을 Games 시트에서 찾을 수 없습니다.");
    return;
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colId]) === String(gameId)) {
      sheet.getRange(i + 1, colStatus + 1).setValue(status);
      
      if (colRenter !== -1 && renter !== undefined) sheet.getRange(i + 1, colRenter + 1).setValue(renter);
      
      // [NEW] renter_id 지원
      const colRenterId = headers.indexOf("renter_id");
      if (colRenterId !== -1 && arguments.length > 5 && arguments[5] !== undefined) {
         sheet.getRange(i + 1, colRenterId + 1).setValue(arguments[5]); // 6번째 인자로 renterId 받음
      }

      if (colDue !== -1 && dueDate !== undefined) sheet.getRange(i + 1, colDue + 1).setValue(dueDate);
      
      Logger.log(`✅ [성공] 게임(${gameId}) 상태 변경: ${status}`);
      break; 
    }
  }
}

// 5. 게임 태그 업데이트 (Safe)
function updateGameTagsSafe(sheet, gameId, newTags) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf("id");
  const colTags = headers.indexOf("tags");

  if (colId === -1 || colTags === -1) return;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colId]) === String(gameId)) {
      sheet.getRange(i + 1, colTags + 1).setValue(newTags);
      break;
    }
  }
}

// 6. 대여자 정보 삭제
function clearRenterInfo(sheet, gameId) {
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const colId = h.indexOf("id");
  const colRenter = h.indexOf("renter");
  const colDue = h.indexOf("due_date");
  
  if (colId === -1) return;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colId]) === String(gameId)) {
      if (colRenter !== -1) sheet.getRange(i + 1, colRenter + 1).setValue("");
      
      const colRenterId = h.indexOf("renter_id");
      if (colRenterId !== -1) sheet.getRange(i + 1, colRenterId + 1).setValue("");

      if (colDue !== -1) sheet.getRange(i + 1, colDue + 1).setValue("");
      break;
    }
  }
}

// 7. 통계(조회수/찜) 증가
function incrementStatSafe(sheet, gameId, colName) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIndex = headers.indexOf(colName);
  const idIndex = headers.indexOf("id");

  if (colIndex === -1 || idIndex === -1) return;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIndex]) === String(gameId)) {
      const cell = sheet.getRange(i + 1, colIndex + 1);
      const currentVal = cell.getValue() || 0;
      cell.setValue(currentVal + 1);
      break;
    }
  }


  // 첫 번째 데이터 행(2번째 줄)을 가져와서 분석
  const firstRow = data[1]; 
  
  Logger.log("=== 📊 데이터 구조 진단 ===");
  Logger.log("0번 컬럼 (ID여야 함): " + firstRow[0]);
  Logger.log("1번 컬럼 (GameID여야 함): " + firstRow[1]);
  Logger.log("3번 컬럼 (비번여야 함): " + firstRow[3]);
  Logger.log("==========================");
  
  // 내가 지우려는 그 ID가 진짜 있는지 확인
  const targetId = "rev_1764865565408";
  let found = false;
  for (let i = 0; i < data.length; i++) {
    // 공백 제거하고 비교
    if (String(data[i][0]).trim() === targetId) {
      Logger.log("✅ 찾았다! " + (i+1) + "번째 줄에 ID가 존재함.");
      found = true;
      break;
    }
  }
  
  if (!found) Logger.log("❌ 전체 시트를 뒤졌으나 '" + targetId + "'를 찾지 못함. (공백 문제 아님)");
}

// 8. 네이버 검색 API 내부 함수
function searchNaverShopInternal(query) {
  try {
    const url = "https://openapi.naver.com/v1/search/shop.json?query=" + encodeURIComponent(query) + "&display=10";
    const headers = { "X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET };
    const res = UrlFetchApp.fetch(url, { headers: headers });
    return { status: "success", items: JSON.parse(res.getContentText()).items };
  } catch (e) { return { status: "error", message: e.toString() }; }
}

// 9. BGG 데이터 가져오기
function fetchBggDataSafe(bggId) {
  const c = String(bggId).trim().split(".")[0];
  if (!c || c === "undefined") return null;
  
  const url = `https://boardgamegeek.com/xmlapi2/thing?id=${c}&stats=1`;
  try {
    const options = { 
      'method': 'get', 
      'muteHttpExceptions': true, 
      'headers': { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } 
    };
    const res = UrlFetchApp.fetch(url, options);
    if (res.getResponseCode() !== 200) return null;
    
    const xml = res.getContentText();
    const item = XmlService.parse(xml).getRootElement().getChild("item");
    if (!item) return null;
    
    const weight = item.getChild("statistics").getChild("ratings").getChild("averageweight").getAttribute("value").getValue();
    const links = item.getChildren("link");
    let genres = [];
    links.forEach(l => { if (l.getAttribute("type").getValue() === "boardgamecategory") genres.push(l.getAttribute("value").getValue()); });
    
    return { difficulty: parseFloat(weight).toFixed(2), genre: genres.slice(0, 3).join(", ") };
  } catch (e) { return null; }
}

// 10. 트렌드 분석
// 10. 트렌드 분석 (캐싱 적용: 6시간)
function getTrendingGamesInternal(days) {
  // 1. 캐시 확인 (메모리에 저장된 값이 있는지?)
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get("trending_cache_v1"); // 키 이름

  // 2. 캐시가 있으면 계산 안 하고 바로 반환 (0.1초 컷)
  if (cachedData != null) {
    return JSON.parse(cachedData);
  }

  // 3. 캐시 없으면 시트 읽어서 계산 (기존 로직)
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  
  // 데이터가 너무 많으면 최근 2000줄만 읽도록 최적화 가능 (선택사항)
  // const lastRow = sheet.getLastRow();
  // const startRow = Math.max(1, lastRow - 2000);
  // const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, sheet.getLastColumn()).getValues();
  const data = sheet.getDataRange().getValues(); // 일단 전체 읽기 유지

  const h = data[0];
  const now = new Date();
  const cutoff = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)); 
  const counts = {};
  
  const colId = h.indexOf("game_id");
  const colType = h.indexOf("action_type");
  const colTime = h.indexOf("timestamp");
  
  if (colId < 0 || colType < 0) return [];

  for (let i = data.length - 1; i > 0; i--) {
    const row = data[i];
    // 날짜 컬럼이 유효한지 체크
    if (row[colTime] && new Date(row[colTime]) < cutoff) break; 
    
    if (row[colType] === "VIEW" && row[colId]) {
      counts[row[colId]] = (counts[row[colId]] || 0) + 1;
    }
  }
  
  const result = Object.keys(counts)
    .map(id => ({ id: id, count: counts[id] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 4. 결과를 캐시에 저장 (21600초 = 6시간 동안 유지)
  cache.put("trending_cache_v1", JSON.stringify(result), 21600);
  
  return result;
}

// 11. 자동 청소부 (트리거용)
function autoReleaseDibs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.GAMES);
  const logSheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  
  const col = { 
    id: h.indexOf("id"), 
    status: h.indexOf("status"), 
    renter: h.indexOf("renter"), 
    due: h.indexOf("due_date") 
  };
  
  if (col.status === -1 || col.due === -1) return;

  const now = new Date();
  for (let i = 1; i < data.length; i++) {
    const status = data[i][col.status];
    const dueStr = data[i][col.due];
    const gameId = data[i][col.id];
    
    if (status === "찜" && dueStr && now > new Date(dueStr)) {
      sheet.getRange(i + 1, col.status + 1).setValue("대여가능");
      if(col.renter !== -1) sheet.getRange(i + 1, col.renter + 1).setValue("");
      if(col.due !== -1) sheet.getRange(i + 1, col.due + 1).setValue("");
      
      logAction(logSheet, gameId, "AUTO_CANCEL", "시간만료", "System");
      
      // ✅ [Fix] Rentals 시트에서도 찜 내역 삭제 (MyPage 동기화)
      // deleteRentalByGameId는 MemberService.gs에 정의된 전역 함수
      try {
        if (typeof deleteRentalByGameId === 'function') {
           deleteRentalByGameId(gameId); 
        } else {
           Logger.log("⚠️ deleteRentalByGameId function not found");
        }
      } catch (e) {
        Logger.log("Rentals cleanup failed: " + e.toString());
      }
    }
  }
}

// 12. 비번 설정 (1회용)
function setAdminPassword() {
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', 'test1234'); // 원하는 비번 입력
  Logger.log("비밀번호 저장됨");
}

// 13. [핵심] 게임 평점 및 리뷰 수 재계산 (Review Add/Delete 시 호출)
function updateGameRatingStats(gameId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reviewSheet = ss.getSheetByName(SHEET_NAMES.REVIEWS);
  const gameSheet = ss.getSheetByName(SHEET_NAMES.GAMES);
  
  // 1. 모든 리뷰 가져와서 해당 게임의 리뷰만 필터링
  const reviews = reviewSheet.getDataRange().getValues();
  // (Reviews 시트: 0:ID, 1:GameID, 2:User, 3:PW, 4:Rating, 5:Comment, 6:Date)
  // 헤더가 있다면 i=1부터 시작
  const targetReviews = reviews.filter((r, i) => i > 0 && String(r[1]) === String(gameId));
  
  const count = targetReviews.length;
  let average = 0;
  
  if (count > 0) {
    const sum = targetReviews.reduce((acc, curr) => acc + Number(curr[4]), 0);
    average = (sum / count).toFixed(2); // 소수점 2자리까지
  }

  // 2. Games 시트에서 해당 게임 행 찾아서 업데이트
  const games = gameSheet.getDataRange().getValues();
  const headers = games[0];
  const colId = headers.indexOf("id");
  const colAvg = headers.indexOf("avg_rating");  
  const colCnt = headers.indexOf("review_count");

  if (colId === -1) return;

  for (let i = 1; i < games.length; i++) {
    if (String(games[i][colId]) === String(gameId)) {
      // getRange는 1부터 시작하므로 +1
      gameSheet.getRange(i + 1, colAvg + 1).setValue(average);
      gameSheet.getRange(i + 1, colCnt + 1).setValue(count);
      break;
    }
  }
}


// 14. [Helper] Game Name 찾기
function getGameNameById(sheet, gameId) {
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const colId = h.indexOf("id");
  const colName = h.indexOf("name");
  
  if (colId === -1 || colName === -1) return "Unknown Game";

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colId]) === String(gameId)) {
      return data[i][colName];
    }
  }
  return "Unknown Game";
}

// 15. [Helper] User ID로 유저 정보 찾기 (이름, 전화번호)
function getUserInfoById(userId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.USERS);
  if (!sheet) return null;
  
  const data = sheet.getDataRange().getValues();
  // 헤더가 있다고 가정하고 1부터 시작
  // Users 시트 구조: Name(0), ID(1), PW(2), Phone(3)...
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(userId)) {
      return {
        name: data[i][0],
        phone: data[i][3]
      };
    }
  }
  return null;
}

// 16. [Helper] Game ID로 상태(Status) 조회
function getStatusById(sheet, gameId) {
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const colId = h.indexOf("id");
  const colStatus = h.indexOf("status");
  
  if (colId === -1 || colStatus === -1) return "Unknown";

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colId]) === String(gameId)) {
      return data[i][colStatus];
    }
  }
  return "Unknown";
}
