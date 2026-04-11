/* Main.gs */
// 요청을 처리할 함수들의 지도 (Routing Map)
const HANDLERS = {
  // 게임 관련
  "getGames": getGamesList,
  "addGame": addNewGame,
  "editGame": editGameInfo,
  "deleteGame": deleteGamePermanently,
  "dibs": rentGameDibs,
  "rent": handleGameRent,
  "miss": requestRestock,
  "view": incrementViewCount,
  "searchBGG": searchBGG,
  "getBGGDetails": getBGGDetails,
  
  // 관리자/상태 변경
  "adminUpdate": updateGameStatusOrTags,
  "approveDibsByRenter": batchApproveDibs,
  "returnGamesByRenter": batchReturnGames,
  "getGameLogs": getGameLogs,
  
  
  // 기타 기능
  "login": adminLogin,
  "searchNaver": searchNaverShop,
  "getReviews": getReviewList,
  "addReview": addUserReview,
  "deleteReview": removeUserReview,
  "getTrending": getTrendingGames,
  "getConfig": getConfigData,
  "saveConfig": saveConfigData,

  // ▼ (전역 설정 관리)
//  "getSettings": getSystemSettings,
//  "saveSettings": saveSystemSettings,

  "loginUser": handleUserLogin, // 유저 로그인
  "signup": handleUserSignup,    // 회원가입 (추가됨)
  "getUsers": getUsers,
  "getMyRentals" : getMyRentals // 마이페이지
  
};

function doGet(e) {
  const action = e.parameter.action;
  if (HANDLERS[action]) {
    return HANDLERS[action](e.parameter); // GET 요청 처리
  }
  return responseJSON({ status: "error", message: "Unknown Action (GET)" });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(3000); // 동시성 제어
    
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    
    if (HANDLERS[action]) {
      return HANDLERS[action](payload); // POST 요청 처리 (함수 호출)
    } else {
      return responseJSON({ status: "error", message: "Unknown Action (POST)" });
    }
    
  } catch (error) {
    return responseJSON({ status: "error", message: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

// HANDLERS["loginUser"]가 찾고 있는 함수
function handleUserLogin(params) {
  // 이미 있는 MemberService.gs의 로직을 호출해서 연결해줌
  return MemberService.login(params);
}

// HANDLERS["signup"]이 찾고 있는 함수
function handleUserSignup(params) {
  return MemberService.signup(params);
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
