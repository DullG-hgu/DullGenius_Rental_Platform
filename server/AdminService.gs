/* AdminService.gs */

// 1. 관리자 로그인
function adminLogin(payload) {
  const savedPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (String(payload.password) === String(savedPassword)) {
    return responseJSON({ status: "success" });
  }
  return responseJSON({ status: "error", message: "Wrong password" });
}

// 2. 상태 변경 및 태그 수정 (관리자)
function updateGameStatusOrTags(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gameSheet = ss.getSheetByName(SHEET_NAMES.GAMES);

  if (payload.status) {
    let renterDisplay = payload.renter; 
    let userIdForLog = payload.user_id; 

    // (기존 로직: 현장대여 시 빈 이름 채우기 등... 그대로 유지)
    if (payload.status === "대여중" && !renterDisplay && !userIdForLog) {
      const currentRenter = getRenterByGameId(gameSheet, payload.game_id);
      if (currentRenter) {
        renterDisplay = currentRenter; 
        userIdForLog = "ExistingUser"; 
      }
    }
    // (기존 로직: 회원 정보 조회)
    if (payload.status === "대여중" && payload.user_id) {
      const userInfo = getUserInfoById(payload.user_id);
      if (userInfo) {
        renterDisplay = `${userInfo.name}(${userInfo.phone})`;
        userIdForLog = payload.user_id;
      }
    }
    if (!renterDisplay) renterDisplay = undefined;

    // 1️⃣ 로그 내용 미리 준비
    let logType = "ADMIN_UPDATE";
    let logValue = renterDisplay || payload.status; 

    if (payload.status === "대여중") {
      logType = "RENT";
    } 
    else if (payload.status === "대여가능") { // ⭐ [반납 로직 수정]
      logType = "RETURN";
      
      // 반납 처리 '직전'에 현재 시트에 적힌 대여자 정보(이름)를 가져옵니다.
      const currentRenter = getRenterByGameId(gameSheet, payload.game_id);
      
      if (currentRenter) {
        // 프론트엔드가 인식할 수 있는 포맷(→ [])으로 로그 내용을 만듭니다.
        logValue = `반납완료 → [${currentRenter}]`;
      } else {
        logValue = "반납완료";
      }
      
      // 반납 시 Rentals에서도 삭제
      deleteRentalByGameId(payload.game_id);
      
    } 
    else if (payload.status === "분실") {
      logType = "LOST";
    }

    // [NEW] 만약 어드민이 강제로 "대여중"으로 상태를 바꿨다면, Rentals에도 추가해줘야 함
    if (payload.status === "대여중" && userIdForLog !== "ExistingUser" && userIdForLog !== "Admin") {
       
       // [Fix] ID가 없고 이름만 있다면, Users 시트에서 학번 역추적 (완전한 해결책)
       if (!userIdForLog && renterDisplay) {
          const users = getData(SHEET_NAMES.USERS);
          const foundUser = users.find(u => u.name === renterDisplay);
          if (foundUser) {
             userIdForLog = foundUser.student_id || foundUser.studentId;
          }
       }

       if (userIdForLog) {
       // 게임 이름 찾기
       const gameName = getGameNameById(gameSheet, payload.game_id);
       // 중복 방지를 위해 Rental이 없는 경우에만 추가하는 로직이 있으면 좋지만, 간단히 추가
       // [Fix] 기존 찜/대여 기록이 있을 수 있으므로 먼저 삭제 (중복 방지)
       deleteRentalByGameId(payload.game_id);

       addRentalRow(userIdForLog, payload.game_id, gameName);
       }
    }

    // 2️⃣ 상태 업데이트 실행 (반납이면 여기서 시트의 대여자 정보가 지워짐)
    // updateGameStatusSafe(sheet, gameId, status, renter, dueDate, renterId)
    updateGameStatusSafe(gameSheet, payload.game_id, payload.status, renterDisplay, payload.due_date, userIdForLog);
    
    // 3️⃣ 로그 남기기 (위에서 만든 logValue 사용)
    logAction(ss.getSheetByName(SHEET_NAMES.LOGS), payload.game_id, logType, logValue, userIdForLog || "Admin");
    
    // 반납인 경우 대여자 정보 삭제 (순서 중요: 로그 남긴 뒤 삭제는 Utils의 updateGameStatusSafe에서 이미 처리될 수도 있으나, 안전하게 여기서도 체크)
    if (payload.status === "대여가능") clearRenterInfo(gameSheet, payload.game_id);
  }

  if (payload.tags !== undefined) {
    updateGameTagsSafe(gameSheet, payload.game_id, payload.tags);
  }
  return responseJSON({ status: "success" });
}


// 3. 일괄 수령 (이름 기준 매칭 유지하되 로그 강화)
function batchApproveDibs(payload) {
  // payload.renter_name: 찜한 사람 이름 (예: "홍길동")
  
  return processBatchAction("찜", payload.renter_name, (sheet, row, colStatus) => {
    
    const gameId = sheet.getRange(row, 1).getValue(); 
    const gameName = sheet.getRange(row, 2).getValue(); 

    // 1️⃣ Games 시트에서 renter_id (학번) 찾기
    const h = sheet.getDataRange().getValues()[0];
    const colRenterId = h.indexOf("renter_id");
    
    let userId = "";
    if (colRenterId !== -1) {
       userId = sheet.getRange(row, colRenterId + 1).getValue(); // 학번 가져오기
    }
    
    // 만약 renter_id가 없다면(비회원/구버전 등), payload로 넘어온 user_id를 쓸 수도 있음 (선택사항)
    if (!userId && payload.user_id) userId = payload.user_id;

    // [Fix] 그래도 ID가 없다면, 이름으로 Users 시트에서 학번을 역추적 (학번 통일 보장)
    if (!userId && payload.renter_name) {
       const users = getData(SHEET_NAMES.USERS);
       // Users 시트: Name(0), ID(1)
       const foundUser = users.find(u => u.name === payload.renter_name);
       if (foundUser) {
          userId = foundUser.student_id || foundUser.studentId; // 컬럼명 유동적 대응
       }
    }

    // 2️⃣ Rentals 시트에 대여 기록 확정 (실제 대여 시작)
    // ID가 없으면 이름이라도 기록
    const finalId = userId || payload.renter_name || "Unknown";
    
    // [Fix] 기존 찜(Dibs) 기록 삭제 후 대여(Rent) 기록 추가 (중복 방지)
    deleteRentalByGameId(gameId);
    
    addRentalRow(finalId, gameId, gameName);

    // 3️⃣ Games 시트 상태 변경 (대여중)
    sheet.getRange(row, colStatus + 1).setValue("대여중");

    return "RENT"; // 로그 타입 반환
  }, "BatchAdmin"); 
}

// 4. 일괄 반납
function batchReturnGames(payload) {
  // 로그 내용(마지막 인자)을 "일괄반납 → [이름]" 형태로 변경
  return processBatchAction("대여중", payload.renter_name, (sheet, row, colStatus, colRenter, colDue) => {

    const gameId = sheet.getRange(row, 1).getValue();
    deleteRentalByGameId(gameId);
    
    sheet.getRange(row, colStatus + 1).setValue("대여가능");
    if (colRenter !== -1) sheet.getRange(row, colRenter + 1).setValue("");
    if (colDue !== -1) sheet.getRange(row, colDue + 1).setValue("");
    return "RETURN";
  }, `일괄반납 → [${payload.renter_name}]`); // 👈 여기가 핵심 변경점!
}

// 5. 리뷰 관련
function getReviewList() {
  return responseJSON(getData(SHEET_NAMES.REVIEWS));
}

function addUserReview(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REVIEWS);
  sheet.appendRow(["rev_" + Date.now(), payload.game_id, payload.user_name, payload.password, payload.rating, payload.comment, new Date().toLocaleString()]); 
  updateGameRatingStats(payload.game_id);
  return responseJSON({ status: "success" }); 
}

// 5. ⭐ [변경] 관리자용 리뷰 삭제 (비번 체크 포함)
function removeUserReview(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REVIEWS);
  const data = sheet.getDataRange().getValues();
  
  const reqId = String(payload.review_id).trim();
  const reqPw = String(payload.password || "").trim();

  let targetGameId = null; 
  let foundIndex = -1;
  let storedPw = "";

  // 헤더 제외하고 검색
  for (let i = 1; i < data.length; i++) {
    const sheetId = String(data[i][0]).trim(); // 리뷰 ID 컬럼

    if (sheetId === reqId) {
       targetGameId = data[i][1]; // Game ID 저장 (통계 갱신용)
       storedPw = String(data[i][3]).trim();
       foundIndex = i;
       break;
    }
  }

  if (foundIndex !== -1) {
    // 비번 체크 (일치해야 삭제)
    if (storedPw === reqPw) {
      sheet.deleteRow(foundIndex + 1);
      if (targetGameId) updateGameRatingStats(targetGameId);
      return responseJSON({status: "success"});
    } else {
      return responseJSON({status: "error", message: "비밀번호가 일치하지 않습니다."});
    }
  }
  
  return responseJSON({status: "error", message: "삭제할 리뷰를 찾을 수 없습니다."});
}

// 6. 설정 관련
function getConfigData() {
  return responseJSON(getData(SHEET_NAMES.CONFIG));
}

function saveConfigData(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.CONFIG);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  
  if (payload.configList && payload.configList.length > 0) {
    const rows = payload.configList.map(c => [c.key, c.label, c.value, c.color]);
    sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  }
  return responseJSON({ status: "success" });
}

// 7. [개선] 특정 게임의 로그 조회 (모든 user_id 표시 버전)
function getGameLogs(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  const data = logSheet.getDataRange().getValues();
  
  const h = data[0];
  const colGameId = h.indexOf("game_id");
  const colType = h.indexOf("action_type");
  const colVal = h.indexOf("value");
  const colTime = h.indexOf("timestamp");
  
  // 헤더 찾기 (대소문자/공백 무시하고 찾기)
  let colUid = -1;
  for(let i=0; i<h.length; i++) {
    // "user_id", "userid", "UserId" 등 유연하게 찾음
    if(String(h[i]).toLowerCase().replace(/_/g, "").trim() === "userid") {
      colUid = i; break;
    }
  }
  
  if (colGameId === -1) return responseJSON({ status: "error", message: "Log Header Error" });

  // 1. 유저 맵 생성
  const users = getData(SHEET_NAMES.USERS);
  const userMap = {};
  users.forEach(u => {
    userMap[String(u.id)] = { 
      name: u.name, 
      phone: u.phone_number || u.phone || "번호없음" 
    };
  });

  const logs = [];
  const targetId = String(payload.game_id);

  // 2. 로그 탐색
  for (let i = data.length - 1; i > 0; i--) {
    if (String(data[i][colGameId]) === targetId) {
      if (data[i][colType] === "VIEW") continue;

      let displayValue = data[i][colVal];
      
      // 로그에 적힌 UID 가져오기
      let logUid = (colUid !== -1) ? data[i][colUid] : null;

      // ⭐ [핵심 수정] UID가 존재하면 무조건 표시 로직
      if (logUid) {
        logUid = String(logUid).trim();
        
        // [CASE 1] Users 목록에 있는 '정식 회원'인 경우 -> 예쁜 이름+번호로 변환
        if (userMap[logUid]) {
          const userInfo = userMap[logUid];
          displayValue = `${displayValue} → [${userInfo.name}, ${userInfo.phone}]`;
        } 
        // [CASE 2] 회원은 아니지만 값이 있는 경우 (예: "Admin", "BatchAdmin") -> 있는 그대로 표시
        else if (logUid !== "") {
          displayValue = `${displayValue} → [${logUid}]`;
        }
      }

      logs.push({
        type: data[i][colType],
        value: displayValue, 
        date: data[i][colTime]
      });
      
      if (logs.length >= 20) break;
    }
  }
  
  return responseJSON({ status: "success", logs: logs });
}

// 일괄 처리 헬퍼 (로그 내용 커스텀 가능)
function processBatchAction(targetStatus, renterName, actionCallback, logUserId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gameSheet = ss.getSheetByName(SHEET_NAMES.GAMES);
  const logSheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  
  const rows = gameSheet.getDataRange().getValues();
  const h = rows[0];
  const idx = {
    status: h.indexOf("status"),
    renter: h.indexOf("renter"),
    due: h.indexOf("due_date"),
    id: h.indexOf("id")
  };
  
  if (idx.status === -1 || idx.renter === -1) return responseJSON({ status: "error" });

  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    // renter 컬럼에 있는 값이 renterName(이름 혹은 ID)을 포함하거나 같은지 확인
    // 기존에 "홍길동(010...)" 처럼 저장되어 있다면 이름만으로 검색하기 위해 includes 사용 가능
    const currentRenter = String(rows[i][idx.renter]);
    
    if (rows[i][idx.status] === targetStatus && currentRenter.includes(renterName)) {
      const logType = actionCallback(gameSheet, i + 1, idx.status, idx.renter, idx.due);
      
      logAction(logSheet, rows[i][idx.id], logType, "일괄처리", logUserId);
      count++;
    }
  }
  return responseJSON({ status: "success", count: count });
}

// 게임 ID로 현재 대여자 정보 가져오기 Helper
function getRenterByGameId(sheet, gameId) {
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const colId = h.indexOf("id");
  const colRenter = h.indexOf("renter");
  
  if (colId === -1 || colRenter === -1) return null;
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colId]) === String(gameId)) {
      return data[i][colRenter]; 
    }
  }
  return null;
}

function getUsers() {
  // 1. Users 시트 데이터 전체 가져오기
  const users = getData(SHEET_NAMES.USERS);

  // 2. 보안 처리: 비밀번호 같은 민감 정보는 빼고, 필요한 정보만 추려서 보냄
  const safeUsers = users.map(u => ({
    id: u.id,                     // 매칭용 고유 ID
    name: u.name,                 // 이름
    phone: u.phone_number || u.phone || "" // 전화번호 (헤더 이름에 따라 자동 처리)
  }));

  // 3. JSON 응답 반환
  return responseJSON(safeUsers);
}
