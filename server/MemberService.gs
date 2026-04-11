/* MemberService.gs */

const MemberService = {
  
  // 1. 회원가입
  // 1. 회원가입
  signup: function(data) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // [Fix] 회원가입은 USERS 시트에 해야 함
    let sheet = ss.getSheetByName(SHEET_NAMES.USERS);

    // 시트가 없으면 생성 (안전장치)
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.USERS);
      sheet.appendRow(["name", "student_id", "password", "phone", "is_paid", "penalty", "last_login", "role"]);
    }

    // 1) 데이터 유효성 검사
    // 프론트엔드에서 보내는 키값: student_id, password, name, phone
    if (!data.student_id || !data.password || !data.name) {
      return responseJSON({ success: false, message: "필수 정보가 누락되었습니다." });
    }

    // 학번 8자리 검증 (서버 측 이중 검증)
    if (String(data.student_id).length !== 8) {
      return responseJSON({ success: false, message: "학번은 정확히 8자리여야 합니다." });
    }

    // 2) 중복 학번 체크 (B열 = Index 1)
    // 2) 중복 학번 체크 (B열 = Index 1)
    if (this._checkDuplicateId(sheet, data.student_id)) {
      try {
        // [Auto-Login] 이미 가입된 학번이라면, 비밀번호 확인 후 로그인 처리
        Logger.log(`[Signup] Duplicate ID found: ${data.student_id}. Attempting Auto-Login.`);
        
        const authResult = this._authenticate(sheet, data.student_id, data.password);
        
        if (authResult.success) {
           return responseJSON({
               success: true,
               message: "기존 계정으로 확인되었습니다. (자동 로그인)",
               user: {
                  name: authResult.row[0],
                  student_id: authResult.row[1],
                  phone: authResult.row[3],
                  is_paid: authResult.row[4],
                  penalty: authResult.row[5],
                  role: authResult.row[7]
               }
           });
        } else {
           return responseJSON({ success: false, message: "이미 가입된 학번입니다. (비밀번호 불일치)" });
        }
      } catch (e) {
        Logger.log(`[Signup Error] ${e}`);
        return responseJSON({ success: false, message: "서버 오류: " + e.toString() });
      }
    }

    var phoneToStore = "'" + data.phone; 
    var passwordToStore = "'" + this._hashPassword(data.password); // [Secure] 해시 저장

    // 3) 초기 변수 설정 및 저장 (8개 컬럼)
    // 순서: name, student_id, password, phone, is_paid, penalty, last_login, role
    sheet.appendRow([
      data.name,           // A: 이름
      data.student_id,     // B: 학번 (ID)
      passwordToStore,       // C: 비밀번호
      phoneToStore,          // D: 전화번호
      false,               // E: 회비 납부 (Default: false)
      0,                   // F: 벌금 (Default: 0)
      "-",                 // G: 접속일 (Default: -)
      "member"             // H: 권한 (Default: member)
    ]);

    return responseJSON({ success: true, message: "회원가입 성공!" });
  },

  // 2. 로그인
  login: function(data) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.USERS);
    
    if (!sheet) {
      return responseJSON({ success: false, message: "회원 데이터가 없습니다." });
    }

    const authResult = this._authenticate(sheet, data.student_id, data.password);

    if (authResult.success) {
        const row = authResult.row; // 전체 행 데이터
        const rowIndex = authResult.rowIndex; // 실제 행 번호 (1-based)

        // 로그인 시간 업데이트 (G열 = Index 6 = 7번째 열)
        const now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
        sheet.getRange(rowIndex, 7).setValue(now);

        return responseJSON({
          success: true,
          message: "로그인 성공",
          user: {
            name: row[0],
            student_id: row[1],
            phone: row[3],
            is_paid: row[4],
            penalty: row[5],
            last_login: now,
            role: row[7]
          }
        });
    }

    return responseJSON({ success: false, message: "학번 또는 비밀번호가 일치하지 않습니다." });
  },

  // 내부 헬퍼 함수: 중복 ID(학번) 확인
  _checkDuplicateId: function(sheet, targetId) {
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][1] == targetId) {
        return true;
      }
    }
    return false;
  },

  // [Refactor] 인증 로직 분리 (순수 검증만 수행)
  _authenticate: function(sheet, inputId, inputPw) {
    const values = sheet.getDataRange().getValues();
    
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      // B열: student_id (Index 1), C열: password (Index 2)
      if (row[1] != inputId) continue;

      const storedPw = String(row[2]);
      const hashedInput = this._hashPassword(inputPw);
      let isMatch = false;

      // Case 1: Legacy (평문 일치)
      if (storedPw === inputPw) {
        isMatch = true;
        // Migration: 비밀번호 해시로 업데이트
        sheet.getRange(i + 1, 3).setValue("'" + hashedInput);
        Logger.log(`[Security] Upgraded password for user: ${row[0]}`);
      }
      // Case 2: Secure (해시 일치)
      else if (storedPw === hashedInput) {
        isMatch = true;
      }

      // [DEBUG]
      Logger.log(`[Auth] ID: ${inputId}, Match: ${isMatch}`);

      if (isMatch) {
        return { success: true, row: row, rowIndex: i + 1 };
      }
    }
    return { success: false };
  },

  // 내부 헬퍼 함수: 사용자 찾기 (로그인 등에서 활용)
  _findUserRowIndex: function(sheet, studentId) {
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][1] == studentId) return i + 1; 
    }
    return -1;
  },

  // 내부 헬퍼 함수: 비밀번호 해싱 (SHA-256)
  _hashPassword: function(password) {
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
};

// 응답 헬퍼 함수 (필수)
function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 마이페이지

// 대여 처리
function handleRent(userId, gameId, gameName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rentalsSheet = ss.getSheetByName("Rentals");
  const logsSheet = ss.getSheetByName("Logs"); // 기존 logs 시트 이름 확인 필요
  
  const now = new Date();
  
  // 1. 반납 기한 계산 (예: 7일 후)
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 7);
  
  // 2. ID 생성
  const rentalId = Utilities.getUuid(); // 고유 ID
  const logId = Utilities.getUuid();

  // 3. Rentals 시트에 추가 (현재 대여 상태)
  // 순서: rental_id, user_id, game_id, game_name, borrowed_at, due_date
  rentalsSheet.appendRow([
    rentalId, 
    userId, 
    gameId, 
    gameName, 
    now.toISOString(), 
    dueDate.toISOString() // 프론트에서 처리하기 쉽게 ISO 문자열로 저장
  ]);

  // 4. Logs 시트에 추가 (역사 기록)
  // 순서: log_id, game_id, action_type, value, time_stamp, user_id
  logsSheet.appendRow([
    logId,
    gameId,
    "RENT",         // action_type
    rentalId,       // value (여기서는 rental_id를 참조값으로 저장 추천)
    now.toISOString(),
    userId
  ]);

  return createJSONOutput({ status: "success", message: "대여 완료" });
}

// 반납 처리
function handleReturn(userId, gameId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rentalsSheet = ss.getSheetByName("Rentals");
  const logsSheet = ss.getSheetByName("Logs");
  
  const data = rentalsSheet.getDataRange().getValues();
  const now = new Date();
  
  // 1. Rentals 시트에서 해당 유저가 해당 게임을 빌린 행 찾기
  // [Refactor] gameId만으로 대여 기록을 찾아 삭제하도록 변경 (deleteRentalByGameId 활용)
  // 이유: user_id가 학번/이름으로 혼용될 수 있으나, game_id는 물리적으로 유일하므로 더 신뢰 가능.
  // 또한, 중복된 대여 기록(버그 등)이 있을 경우 모두 청소하기 위함.
  
  // 삭제 수행 (삭제된 행이 있으면 성공으로 간주)
  deleteRentalByGameId(gameId);

  // 2. (삭제 로직은 위 함수로 대체됨)

  // 3. Logs 시트에 반납 기록 추가
  logsSheet.appendRow([
    Utilities.getUuid(), // log_id
    gameId,
    "RETURN",            // action_type
    rentalId,            // value (어떤 대여 건에 대한 반납인지 연결)
    now.toISOString(),
    userId
  ]);

  return createJSONOutput({ status: "success", message: "반납 완료" });
}

//마이페이지 조회
function getMyRentals(params) {
  // 1. 파라미터에서 userId, name 추출
  const userId = String(params.userId || "").trim();
  const userName = String(params.name || "").trim(); // 이름으로도 검색 지원
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // SHEET_NAMES.RENTALS 상수 사용 (없으면 "Rentals")
  const sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.RENTALS) ? SHEET_NAMES.RENTALS : "Rentals";
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return responseJSON({ status: "error", message: "Rentals 시트가 없습니다." });
  }

  const data = sheet.getDataRange().getValues();
  
  // 데이터가 헤더만 있거나 없는 경우 방어
  if (data.length < 2) {
    return responseJSON({ status: "success", data: [] });
  }

  const rows = data.slice(1); // 헤더 제외

  // 2. user_id(B열, index 1)가 ID 혹은 이름과 일치하는 행 필터링
  // (현장 대여 시 ID 대신 이름이 들어갈 수도 있으므로)
  const myRentals = rows
    .filter(row => {
      const rentalUser = String(row[1]).trim(); // 시트에 적힌 값
      if (!rentalUser) return false;
      
      const isMatch = (userId && rentalUser === userId) || (userName && rentalUser === userName);
      
      // [DEBUG] 로그: 매칭 시도
      if (isMatch) {
         Logger.log(`✅ [MyPage] Found Match! RowUser: ${rentalUser}, Search: ${userId}/${userName}`);
      } else {
         // 너무 많은 로그 방지를 위해 특정 조건이나 앞부분만 살짝 찍어볼 수 있음 (선택)
         // Logger.log(`[MyPage] Skip: ${rentalUser}`);
      }

      return isMatch;
    })
    .map(row => ({
      rentalId: row[0],
      gameId: row[2],
      gameName: row[3],
      borrowedAt: row[4],
      dueDate: row[5]
    }));

  // 3. 기존 Utils의 responseJSON 사용하여 응답 통일
  return responseJSON({ status: "success", data: myRentals });
}


// [New] 반납 시 Rentals 시트 동기화 (행 삭제)
// [Update] 중복 데이터 방지를 위해 역순으로 순회하며 모두 삭제
function deleteRentalByGameId(gameId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rentalSheet = ss.getSheetByName("Rentals");
  if (!rentalSheet) return;

  const data = rentalSheet.getDataRange().getValues();
  // Rentals 시트 구조: rental_id(0) | user_id(1) | game_id(2) ...
  // 헤더가 1행에 있으므로 data길이-1 부터 1(index 1)까지 역순 탐색
  
  let deletedCount = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    // game_id가 일치하는 행을 발견하면 (String 변환 비교)
    if (String(data[i][2]) === String(gameId)) {
      rentalSheet.deleteRow(i + 1); // 행 삭제
      deletedCount++;
      // break를 하지 않음 -> 중복된 기록이 있다면 모두 삭제 (Clean Up)
    }
  }
  Logger.log(`[DeleteRental] GameId: ${gameId}, Deleted Rows: ${deletedCount}`);
}


// [New] Rentals 시트에 대여 기록 추가하는 공통 함수
function addRentalRow(userId, gameId, gameName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // SHEET_NAMES가 정의되어 있으면 사용, 없으면 "Rentals"
  const sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.RENTALS) ? SHEET_NAMES.RENTALS : "Rentals";
  const rentalsSheet = ss.getSheetByName(sheetName);
  
  if (!rentalsSheet) {
    Logger.log("❌ [오류] Rentals 시트를 찾을 수 없습니다.");
    return; 
  }

  const now = new Date();
  const rentalId = Utilities.getUuid();
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 7);

  // 순서: rental_id | user_id | game_id | game_name | borrowed_at | due_date
  rentalsSheet.appendRow([
    rentalId, 
    userId,   
    gameId, 
    gameName, 
    now.toISOString(), 
    dueDate.toISOString() 
  ]);
  
  Logger.log(`✅ [성공] 대여 기록 추가: ${gameName} -> ${userId}`);
  return rentalId; 
}