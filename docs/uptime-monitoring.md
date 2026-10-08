# 사이트 다운 알림 설정 (UptimeRobot)

사이트나 DB가 죽으면 운영자에게 **메일이 오도록** 하는 설정이다.
코드를 몰라도 이 문서 순서대로 하면 된다. 처음 한 번만 하면 된다.

> 계기: 2026-10-04 16:33~16:57 (25분) DB(Supabase)가 응답하지 않아 사이트 전체가 멈췄는데,
> 아무도 몰랐다. 이 설정이 있으면 5분 안에 메일이 온다.

---

## 1. 무엇을 감시하나

감시 주소: **`https://dullgrental.netlify.app/.netlify/functions/health`**

이 주소를 열면 서버가 DB에 아주 가볍게 한 번 물어보고 결과를 돌려준다.

| 상태 | 화면에 보이는 것 | 뜻 |
|------|------------------|----|
| 정상 | `{"ok":true}` (HTTP 200) | 사이트(Netlify)도, DB(Supabase)도 살아 있다 |
| 이상 | `{"ok":false}` (HTTP 503) | 사이트는 떠 있지만 **DB가 응답하지 않는다** (5초 넘게 무응답 포함) |
| 아예 안 열림 | 오류 페이지 / 연결 실패 | **사이트(Netlify) 자체**가 죽었거나 주소가 바뀌었다 |

즉 이 주소 하나로 **Netlify와 Supabase 둘 다** 감시된다.

브라우저로 위 주소를 직접 열어 `{"ok":true}`가 보이면 준비 완료다.
(아직 배포 전이면 "Page not found"가 뜬다 — 배포가 먼저다.)

---

## 2. UptimeRobot 가입 (무료)

1. https://uptimerobot.com 접속 → **Register for FREE** (또는 Sign up).
2. 운영 메일 주소(예: 동아리 공용 Gmail)로 가입한다. **알림은 이 주소로 온다.**
   - 개인 메일로 가입하면 담당자가 바뀔 때 알림이 끊긴다. 공용 계정을 쓰자.
3. 가입 확인 메일의 링크를 눌러 인증한다.

무료 플랜으로 충분하다 (5분 간격 감시, 메일 알림 포함). 결제 정보는 넣지 않는다.

---

## 3. 모니터 등록

1. 로그인 후 대시보드에서 **+ New monitor** (또는 Add New Monitor) 를 누른다.
2. 아래처럼 채운다.

   | 항목 | 값 |
   |------|----|
   | Monitor type | **HTTP(s)** |
   | Friendly name | `덜지니어스 대여 사이트` (아무 이름이나) |
   | URL (or IP) | `https://dullgrental.netlify.app/.netlify/functions/health` |
   | Monitoring interval | **5 minutes** (무료 플랜 최소값) |

3. **알림 받을 곳(Integrations & Team / Alert contacts)** 에서 가입한 메일 주소에 체크가 되어 있는지 확인한다.
   - 다른 운영진도 받게 하려면 여기서 메일 주소를 추가한다 (추가된 사람에게 확인 메일이 간다).
4. **Create monitor** 를 누른다.
5. 1~2분 뒤 대시보드에서 상태가 초록색 **Up** 으로 바뀌면 끝.

> 다른 항목(키워드, 헤더, 인증 등)은 건드리지 않는다. 기본값이면 된다.
> UptimeRobot 화면 문구는 바뀔 수 있다. 위 네 가지 값만 맞으면 된다.

---

## 4. 알림 메일이 오면 — 대응 순서

메일 제목에 **Down** 이 들어 있으면 아래 순서로 본다.

### ① 사이트를 직접 열어 본다
- https://dullgrental.netlify.app 접속.
- 그리고 감시 주소 https://dullgrental.netlify.app/.netlify/functions/health 접속.
  - `{"ok":false}` 가 보이면 → **DB 문제**. ②로.
  - 아예 안 열리면 → **Netlify 문제**. ③으로.

### ② Supabase (DB) 확인 — 가장 흔한 경우
1. https://supabase.com/dashboard 로그인 → 이 프로젝트 선택.
2. 프로젝트 첫 화면(Project overview)에서 상태 표시를 본다.
   - **Paused(일시정지)** 라면 → **Restore / Resume project** 를 누른다. 몇 분 걸린다.
   - 상태가 이상하거나(Unhealthy, 응답 없음) CPU·메모리 그래프가 꽉 차 있으면 →
     **Settings → General** 아래쪽의 **Restart project** (또는 Restart server) 를 누른다. 몇 분 걸린다.
3. https://status.supabase.com 에서 Supabase 전체 장애인지도 확인한다.
   전체 장애면 우리가 할 일은 없다. 복구를 기다린다.

### ③ Netlify (사이트) 확인
1. https://app.netlify.com 로그인 → 이 사이트 선택.
2. **Deploys** 에서 마지막 배포가 실패(Failed)했는지 본다.
3. https://www.netlifystatus.com 에서 Netlify 전체 장애인지 확인한다.

### ④ 복구 확인
- 복구되면 UptimeRobot이 **Up** 메일을 한 번 더 보낸다. 그걸로 끝.
- 언제·얼마나 멈췄는지, 무엇을 눌렀는지 운영진 채팅방에 한 줄 남겨 둔다.

---

## 참고 (개발자용)

- 함수 코드: `netlify/functions/health.js`, 테스트: `tests/health.test.js`.
- `games` 테이블에 `select=id&limit=1` 한 건만 조회한다 (publishable 키, 5초 타임아웃).
  응답에는 `ok` 여부만 담고 오류 상세는 Netlify 함수 로그에만 남는다.
- 서버 env `SUPABASE_URL`(또는 `VITE_SUPABASE_URL`)·`SUPABASE_PUBLISHABLE_KEY` 를 쓴다
  (`supabase-keepalive.js` 와 같음). 이 값이 빠지면 503이 나므로 env 누락도 알림으로 잡힌다.
- 스케줄 함수가 아니다. 외부 감시 서비스가 부를 때만 실행된다.
