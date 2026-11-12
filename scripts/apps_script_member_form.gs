// ============================================================
// 덜지니어스 입부 신청 폼 → Supabase (Google Apps Script)
// ------------------------------------------------------------
// 이 파일은 「단체 대여 폼」 Apps Script 프로젝트에 **파일을 하나 더 추가**해서 붙인다
// (apps_script_form_handler.gs 와 같은 프로젝트). 그래야 스크립트 속성
// SUPABASE_GAS_SECRET · SUPABASE_PUBLISHABLE_KEY 와 SUPABASE_URL 상수를 같이 쓴다 — 비밀값을 한 곳에만 둔다.
//
// 설치 (한 번):
//   1) 아래 MEMBER_FORM_ID 에 입부 신청 폼의 편집 주소 가운데 id 를 넣는다
//      (https://docs.google.com/forms/d/<여기>/edit). 저장소 사본은 비워 둔다 — 콘솔에 붙인 쪽에만 적는다.
//      (스크립트 속성 MEMBER_FORM_ID 로 넣어도 된다)
//   2) 함수 드롭다운에서 installMemberFormTrigger 선택 → 실행 → 권한 허용
//   3) resendMemberApplications 실행 → 이번 학기에 이미 들어온 신청을 DB 로 보낸다
//
// 하는 일:
//   - 폼이 제출되면 학번·이름·전화번호·학부·부문만 DB(ingest_member_application)로 보낸다.
//     오마카세부 서술형 답은 보내지 않는다 (용도 없는 수집 금지).
//   - 폼에 「파일 올리기」 문항(이체 캡처)이 있고 답이 왔으면, 캡처를 사이트 함수로 보내
//     회비 납부까지 같이 판정한다. 그 경로가 실패하면 신청만 넣는다.
// ============================================================

const MEMBER_FORM_ID = '';
const MEMBER_SITE_FUNCTION_URL = 'https://dullgrental.netlify.app/.netlify/functions/member-application';

// 폼 질문 제목에 든 낱말로 답을 찾는다. 제목을 바꾸면 여기를 고친다.
const MEMBER_FIELD_PATTERNS = {
  student_id: ['학번'],
  name:       ['이름', '성함'],
  phone:      ['전화번호', '연락처', '휴대폰'],
  department: ['학부', '전공'],
  track:      ['부문', '활동'],
};

function memberFormId_() {
  const formId = MEMBER_FORM_ID || PropertiesService.getScriptProperties().getProperty('MEMBER_FORM_ID');
  if (!formId) throw new Error('MEMBER_FORM_ID 가 없습니다.');
  return formId;
}

function installMemberFormTrigger() {
  const formId = memberFormId_();
  const form = FormApp.openById(formId);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onMemberFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onMemberFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('[Member] 트리거 설치 완료: %s', form.getTitle());
}

function onMemberFormSubmit(e) {
  try {
    sendMemberApplication_(e.response, true);
  } catch (err) {
    Logger.log('[Member] 예외: %s', (err && err.stack) || err);
  }
}

// 이번 학기(1~6월 / 7~12월)에 들어온 신청을 다시 보낸다. 같은 학번은 DB 가 덮어쓰므로 여러 번 돌려도 된다.
// 캡처 판정은 다시 하지 않는다 (신청 기록만).
function resendMemberApplications() {
  const formId = memberFormId_();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1);
  const responses = FormApp.openById(formId).getResponses(start);
  let ok = 0;
  responses.forEach(function (r) {
    if (sendMemberApplication_(r, false)) ok++;
    Utilities.sleep(300); // DB 를 몰아치지 않는다
  });
  Logger.log('[Member] 다시 보내기: %s건 중 %s건 성공', responses.length, ok);
}

function sendMemberApplication_(response, withProof) {
  const props = PropertiesService.getScriptProperties();
  const publishableKey = props.getProperty('SUPABASE_PUBLISHABLE_KEY');
  const secret = props.getProperty('SUPABASE_GAS_SECRET');
  if (!publishableKey || !secret) {
    Logger.log('[Member] SUPABASE_PUBLISHABLE_KEY / SUPABASE_GAS_SECRET 미설정 - 전송 스킵');
    return false;
  }

  const application = { submitted_at: response.getTimestamp().toISOString() };
  let captureFileId = null;
  response.getItemResponses().forEach(function (it) {
    const item = it.getItem();
    if (item.getType() === FormApp.ItemType.FILE_UPLOAD) {
      const ids = it.getResponse();
      if (ids && ids.length) captureFileId = ids[0];
      return;
    }
    const title = String(item.getTitle() || '').replace(/\s+/g, '');
    Object.keys(MEMBER_FIELD_PATTERNS).forEach(function (key) {
      if (application[key]) return;
      const hit = MEMBER_FIELD_PATTERNS[key].some(function (p) { return title.indexOf(p) !== -1; });
      if (hit) application[key] = String(it.getResponse() == null ? '' : it.getResponse());
    });
  });
  if (!application.student_id) {
    Logger.log('[Member] 학번 문항을 찾지 못함 — MEMBER_FIELD_PATTERNS 확인');
    return false;
  }

  // (1) 캡처가 있으면 사이트 함수로 (판정 + 신청 기록을 한 번에)
  if (withProof && captureFileId) {
    try {
      const blob = DriveApp.getFileById(captureFileId).getBlob();
      const mime = blob.getContentType();
      const bytes = blob.getBytes();
      if (bytes.length <= 4000000 && /^image\/(jpeg|png|webp)$/.test(mime)) {
        const res = UrlFetchApp.fetch(MEMBER_SITE_FUNCTION_URL, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ secret: secret, application: application, image: Utilities.base64Encode(bytes), mime: mime, file_ref: captureFileId }),
          muteHttpExceptions: true,
        });
        Logger.log('[Member] 사이트 함수 %s %s', res.getResponseCode(), res.getContentText());
        if (res.getResponseCode() === 200 && JSON.parse(res.getContentText()).success) return true;
      } else {
        Logger.log('[Member] 캡처를 보내지 않음 (크기 %s, 형식 %s) — 신청만 기록', bytes.length, mime);
      }
    } catch (err) {
      Logger.log('[Member] 캡처 경로 실패, 신청만 기록: %s', err);
    }
  }

  // (2) 신청만 DB 로
  const payload = Object.assign({ secret: secret }, application);
  const res = UrlFetchApp.fetch(SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/ingest_member_application', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'apikey': publishableKey, 'Authorization': 'Bearer ' + publishableKey },
    payload: JSON.stringify({ p_payload: payload }),
    muteHttpExceptions: true,
  });
  Logger.log('[Member] Supabase %s %s', res.getResponseCode(), res.getContentText());
  return res.getResponseCode() === 200 && String(res.getContentText()).indexOf('"success":true') !== -1;
}
