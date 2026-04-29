// ============================================================
// 덜지니어스 외부 대여 Form 핸들러 (Google Apps Script)
// 1) 지정된 이메일 수신자들에게 알림 메일 발송
// 2) Supabase ingest_rental_request RPC 호출 → DB 자동 기록 + HOLD 생성
// ------------------------------------------------------------
// 트리거: Form > On form submit > onFormSubmit (Form-bound)
// Script Properties 필요 (Project Settings > Script Properties):
//   SUPABASE_GAS_SECRET = (private_config.gas_shared_secret 와 동일한 값)
// ============================================================


// Supabase 프로젝트 URL과 anon key는 공개되어도 되는 값이라 하드코딩.
// (실제 보호는 SUPABASE_GAS_SECRET + RPC 내부 시크릿 검증으로 함)
const SUPABASE_URL = 'https://hptvqangstiaatdtusrg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwdHZxYW5nc3RpYWF0ZHR1c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNjcyNDIsImV4cCI6MjA4NDg0MzI0Mn0.zUA1hXHeEblta3kQG6A3ltbKgRfzByDLc6suC_D3ZZc';


// ============================================================
// 알림 메일 수신자
// ------------------------------------------------------------
// 추가/삭제하려면 아래 배열에 이메일 문자열만 넣고 빼면 됩니다.
// 예: ['DullGenius.official@gmail.com', 'manager@example.com']
// ============================================================
const NOTIFY_EMAILS = [
  'DullGenius.official@gmail.com',
];


// ============================================================
// [1회용] Forms 스코프 권한을 강제로 부여받기 위한 더미 함수.
// 사용법: 함수 드롭다운에서 _grantFormsPermission 선택 → ▶ Run →
//        권한 다이얼로그에서 "Google Forms 보기" 항목 포함되어 있는지 확인 → 허용.
// 한 번 실행해서 권한 받으면 이후 트리거가 정상 동작함. 영구 보관 가능.
// ============================================================
function _grantFormsPermission() {
  const f = FormApp.getActiveForm();
  Logger.log('[Forms 권한] OK. Form title: %s', f ? f.getTitle() : '(no active form)');
}


function onFormSubmit(e) {
  // (1) 알림 메일 발송
  try {
    sendNotificationEmails(e);
  } catch (err) {
    Logger.log('[Mail] 예외: %s', (err && err.stack) || err);
  }

  // (2) Supabase 기록 (실패해도 메일은 이미 나갔으므로 분리)
  try {
    postRentalRequestToSupabase(e);
  } catch (err) {
    Logger.log('[Supabase] 예외: %s', (err && err.stack) || err);
  }
}


// ------------------------------------------------------------
// 알림 메일 발송
// ------------------------------------------------------------
function sendNotificationEmails(e) {
  if (!NOTIFY_EMAILS || NOTIFY_EMAILS.length === 0) {
    Logger.log('[Mail] NOTIFY_EMAILS 비어있음 - 발송 스킵');
    return;
  }

  const subject = '🚀 [덜지니어스] 새로운 단체 대여 신청이 접수되었습니다!';

  let message = '새로운 단체 대여 신청서가 도착했습니다.\n\n';
  message += '========================================\n\n';

  const items = e.response.getItemResponses();
  for (let i = 0; i < items.length; i++) {
    const question = items[i].getItem().getTitle();
    const answer   = items[i].getResponse();
    message += '▶ ' + question + '\n  : ' + answer + '\n\n';
  }

  message += '========================================\n';
  message += '해당 단체에게 안내 메일을 회신하시거나, 대시보드에서 대여 승인 절차를 진행해 주세요.';

  // 한 번의 호출로 여러 명에게 전송 (쉼표 구분 문자열)
  MailApp.sendEmail(NOTIFY_EMAILS.join(','), subject, message);
  Logger.log('[Mail] %d명에게 발송: %s', NOTIFY_EMAILS.length, NOTIFY_EMAILS.join(', '));
}


// ------------------------------------------------------------
// 폼 답변 → 표준 키 매핑
// 질문 제목의 일부 문자열로 매칭 (제목이 약간 변해도 견딜 수 있게).
// 첫 번째로 매칭되는 패턴 사용. 모두 소문자 + 공백·구두점 제거 후 비교.
// ------------------------------------------------------------
const FORM_FIELD_PATTERNS = {
  org_type:            ['단체의성격', '단체성격'],
  org_name:            ['단체명'],
  event_overview:      ['행사의개요', '행사개요'],
  event_schedule:      ['일정계획'],
  audience_notes:      ['연령층', '특이사항'],
  requested_games_raw: ['원하는보드게임'],
  game_count_raw:      ['게임의개수', '게임개수'],
  rental_duration_raw: ['대여기간'],
  requester_name:      ['작성자의이름', '작성자이름'],
  requester_phone:     ['작성자의연락처', '연락처'],
  pickup_raw:          ['수령일정', '수령일'],
};

function _normalizeTitle(s) {
  return String(s || '').toLowerCase().replace(/[\s\.\,\?\!\(\)\[\]\/]+/g, '');
}

function extractAnswers(e) {
  const out = {};
  if (!e || !e.response || typeof e.response.getItemResponses !== 'function') {
    Logger.log('[extractAnswers] e.response 없음 - 트리거 형식 확인 필요');
    return out;
  }

  const items = e.response.getItemResponses();
  const titleAnswerPairs = items.map(function (it) {
    return {
      title: _normalizeTitle(it.getItem().getTitle()),
      answer: String(it.getResponse() == null ? '' : it.getResponse()),
    };
  });

  Object.keys(FORM_FIELD_PATTERNS).forEach(function (key) {
    const patterns = FORM_FIELD_PATTERNS[key];
    for (let i = 0; i < patterns.length; i++) {
      const p = _normalizeTitle(patterns[i]);
      const hit = titleAnswerPairs.find(function (x) { return x.title.indexOf(p) !== -1; });
      if (hit) {
        out[key] = hit.answer;
        return;
      }
    }
    out[key] = '';
  });

  return out;
}


// ------------------------------------------------------------
// Supabase RPC 호출
// ------------------------------------------------------------
function postRentalRequestToSupabase(e) {
  const SUPABASE_GAS_SECRET = PropertiesService.getScriptProperties().getProperty('SUPABASE_GAS_SECRET');

  if (!SUPABASE_GAS_SECRET) {
    Logger.log('[Supabase] SUPABASE_GAS_SECRET 미설정 - 전송 스킵');
    return;
  }

  const a = extractAnswers(e);
  Logger.log('[Supabase] 추출된 답변: %s', JSON.stringify(a));

  const payload = {
    _secret:             SUPABASE_GAS_SECRET,
    submitted_at:        new Date().toISOString(),
    org_type:            a.org_type            || '',
    org_name:            a.org_name            || '',
    event_overview:      a.event_overview      || '',
    event_schedule:      a.event_schedule      || '',
    audience_notes:      a.audience_notes      || '',
    requested_games_raw: a.requested_games_raw || '',
    game_count_raw:      a.game_count_raw      || '',
    rental_duration_raw: a.rental_duration_raw || '',
    requester_name:      a.requester_name      || '',
    requester_phone:     a.requester_phone     || '',
    pickup_raw:          a.pickup_raw          || '',
  };

  const url = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/ingest_rental_request';

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    },
    payload: JSON.stringify({ p_payload: payload }),
    muteHttpExceptions: true,
  });

  Logger.log('[Supabase] %s %s', res.getResponseCode(), res.getContentText());
}
