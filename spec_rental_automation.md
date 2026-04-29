# Feature Spec: 외부 대여 예약 자동화 (Google Form → HOLD)

**작성자:** Claude (Architect)
**작성일:** 2026-04-21
**대상:** @scout (프론트 구현 — 관리자 탭), @gemini (리뷰 — DB·RPC·GAS 보안)

---

## 배경 및 문제

- 외부 단체(행사 주최자)가 Google Form으로 보드게임 대여 신청
- 기존 GAS는 **특정 이메일로 알림만** 발송, DB에 기록되지 않음
- 결과: 고객이 지정한 날짜에 게임이 이미 내부 대여 나가 있어 **"예약 방어 안 되냐"는 클레임 발생**
- 결제·수령은 현장에서 수동 유지 (자동화 대상 아님)

---

## 최종 흐름

```
[Google Form submit]
    ↓ GAS on-submit (기존 알림 트리거에 덧붙임)
    ↓ POST
[Supabase RPC: ingest_rental_request(p_payload jsonb)]
    ├ rental_requests INSERT (raw 보존)
    ├ 게임명 comma-split + 퍼지 매칭
    ├ 수령일·기간 파싱
    │
    ├─ 전부 성공 → rentals INSERT (type='HOLD', user_id=NULL)
    │             status='auto_confirmed'
    │             borrowed_at = pickup_at - 24h
    │             due_date    = pickup_at + 대여기간
    │
    └─ 하나라도 실패 → status='needs_review'
                       → 관리자 탭에서 수동 승인
[rent_game / dibs_game / kiosk_rental]
    ↓ active-count 계산 시 HOLD 포함
    → 해당 구간에 내부 대여 발생 차단
[cleanup_expired_dibs GH Action — 기존]
    ↓ 확장: pickup_at 지난 HOLD 자동 returned_at 처리
```

---

## 1. DB 변경 (Claude 직접 — MCP 도구)

### 1-1. 신규 테이블 `rental_requests`

```sql
CREATE TABLE public.rental_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_at timestamptz NOT NULL,
    received_at timestamptz DEFAULT now(),

    -- 신청자 정보
    requester_name text NOT NULL,
    requester_phone text NOT NULL,

    -- 단체 정보 (4개 모두 채워지면 is_free=true)
    org_type text,
    org_name text,
    event_overview text,
    event_schedule text,
    audience_notes text,

    -- 대여 원본
    requested_games_raw text NOT NULL,  -- 쉼표 구분 원문 "달무티, 스플렌더"
    game_count int,
    rental_fee int,                     -- "(4000원)" 파싱 결과
    rental_duration_raw text,           -- "1일 (대여 다음날 12시까지)" 원문
    pickup_raw text,                    -- 수령일 자유텍스트 원문

    -- 파싱 결과
    is_free bool NOT NULL DEFAULT false,
    matched_game_ids int[] DEFAULT '{}',     -- 매칭된 games.id (부분 매칭 포함)
    pickup_at timestamptz,                   -- 파싱 실패 시 NULL
    duration_days int,                       -- 파싱 실패 시 NULL

    -- 상태
    status text NOT NULL DEFAULT 'pending',
    -- 'pending' | 'auto_confirmed' | 'needs_review' | 'manual_confirmed' | 'rejected' | 'cancelled'
    review_note text,
    reviewed_by uuid REFERENCES public.profiles(id),
    reviewed_at timestamptz,

    -- 생성된 HOLD 연결
    hold_rental_ids uuid[] DEFAULT '{}',

    -- 원본 페이로드 (디버깅·감사용)
    raw_payload jsonb
);

CREATE INDEX idx_rental_requests_status ON public.rental_requests(status);
CREATE INDEX idx_rental_requests_pickup ON public.rental_requests(pickup_at)
    WHERE pickup_at IS NOT NULL;

COMMENT ON COLUMN public.rental_requests.is_free IS
  '공익 무료 대여 여부. org_name/event_overview/event_schedule/audience_notes 4개 필드 모두 채워진 경우 true.';
COMMENT ON COLUMN public.rental_requests.hold_rental_ids IS
  '이 요청으로 생성된 rentals.rental_id 목록 (type=HOLD).';
```

**RLS:**
- `SELECT`: `is_admin()`
- `INSERT`: `SECURITY DEFINER` RPC만 (GAS → RPC 경로)
- `UPDATE`: `is_admin()` (탭에서 승인·반려)
- `DELETE`: 금지

---

### 1-2. `rentals` 테이블

- `type`에 `'HOLD'` 값 추가 (enum 아니라 text — 코드상 문자열만 추가)
- `user_id` NULL 허용 (이미 허용됨 ✅)
- `renter_name`에 신청자 이름 저장, `note`에 "HOLD: request_id=..." 또는 `rental_requests.id` 기록
  → 별도 FK 컬럼 추가 대신 **`note`에 request_id 저장** 으로 최소화

---

### 1-3. active-count 로직 확장 (3개 RPC)

기존:
```sql
(type = 'RENT' OR (type = 'DIBS' AND due_date > now()))
```

변경:
```sql
(
  type = 'RENT'
  OR (type = 'DIBS' AND due_date > now())
  OR (type = 'HOLD'
      AND borrowed_at <= now() + interval '7 days'   -- 새 대여 기본 7일 창 안에 들어오는 HOLD
      AND due_date > now())
)
```

**적용 대상:**
- `rent_game` (line ~941)
- `dibs_game` (line ~249)
- `kiosk_rental` (line ~783)
- `get_games_with_rentals` (line ~415) — 표시용

**`dibs_game`은 30분짜리라 `interval '30 minutes'`로 축소해도 되지만, 7일로 통일하는 게 안전.** HOLD가 1주 내에 잡혀있으면 찜도 막자.

---

### 1-4. `cleanup_expired_dibs` 확장

`rentals.type = 'HOLD'`이면서 `due_date < now()`인 건 자동 `returned_at = now()` 마킹.

```sql
UPDATE public.rentals
SET returned_at = now()
WHERE returned_at IS NULL
  AND type = 'HOLD'
  AND due_date < now()
RETURNING game_id;
-- (기존 DIBS cleanup 쿼리에 이어서 추가)
```

---

## 2. 신규 RPC (Claude 직접)

### 2-1. `ingest_rental_request(p_payload jsonb)` — GAS 호출용

**권한:** `SECURITY DEFINER`. `anon` role에서 호출 가능 (GAS는 anon key 사용) — **다만 GAS에만 알려진 공유 시크릿(payload 내 `_secret` 필드)으로 gating**

```sql
-- 의사 코드
BEGIN
    IF p_payload->>'_secret' IS DISTINCT FROM current_setting('app.gas_shared_secret', true) THEN
        RETURN jsonb_build_object('success', false, 'message', '인증 실패');
    END IF;

    -- 1. 파싱
    v_is_free := (
        p_payload->>'org_name' IS NOT NULL AND p_payload->>'org_name' <> ''
        AND p_payload->>'event_overview' IS NOT NULL AND p_payload->>'event_overview' <> ''
        AND p_payload->>'event_schedule' IS NOT NULL AND p_payload->>'event_schedule' <> ''
        AND p_payload->>'audience_notes' IS NOT NULL AND p_payload->>'audience_notes' <> ''
    );

    v_games_raw := p_payload->>'requested_games_raw';
    v_matched_ids := public._fuzzy_match_games(v_games_raw);  -- 헬퍼 함수

    v_pickup_at := public._parse_pickup(p_payload->>'pickup_raw');
    v_duration_days := public._parse_duration(p_payload->>'rental_duration_raw');
    v_fee := public._parse_fee(p_payload->>'game_count_raw');  -- "2개 (4000원)" → 4000

    -- 2. 요청 INSERT
    INSERT INTO public.rental_requests (...) VALUES (...) RETURNING id INTO v_request_id;

    -- 3. 자동 확정 가능 판정
    v_auto_ok := (
        array_length(v_matched_ids, 1) > 0
        AND v_pickup_at IS NOT NULL
        AND v_duration_days IS NOT NULL
        AND array_length(v_matched_ids, 1) = v_requested_count  -- 1:1 매칭
    );

    IF v_auto_ok THEN
        -- 각 게임별 HOLD 생성
        FOR v_gid IN SELECT unnest(v_matched_ids) LOOP
            -- 충돌 검사: 동일 기간에 HOLD 쌓이는지 (quantity 초과시 needs_review로 전환)
            ...
            INSERT INTO public.rentals (game_id, user_id, game_name, renter_name, type,
                                        borrowed_at, due_date, source, note)
            VALUES (v_gid, NULL, ..., p_payload->>'requester_name', 'HOLD',
                    v_pickup_at - interval '24 hours',
                    v_pickup_at + (v_duration_days || ' days')::interval,
                    'form', 'request:' || v_request_id)
            RETURNING rental_id INTO v_hold_id;
            v_hold_ids := array_append(v_hold_ids, v_hold_id);
        END LOOP;

        UPDATE public.rental_requests
        SET status = 'auto_confirmed', hold_rental_ids = v_hold_ids
        WHERE id = v_request_id;
    ELSE
        UPDATE public.rental_requests
        SET status = 'needs_review'
        WHERE id = v_request_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'status', v_status);
END;
```

---

### 2-2. 헬퍼 함수 3개 (private, `_` prefix)

- **`_fuzzy_match_games(raw text) RETURNS int[]`**
  - `raw`를 `,`로 split
  - 각 토큰에 대해 `games.name = token` (exact) → `ILIKE '%' || token || '%'` fallback
  - 매칭 안 된 토큰은 결과 배열에 포함 안 함

- **`_parse_pickup(raw text) RETURNS timestamptz`**
  - regex: `\d{4}[-./]\d{1,2}[-./]\d{1,2}` + `\d{1,2}[:시]\d{0,2}?`
  - 실패 시 NULL

- **`_parse_duration(raw text) RETURNS int`**
  - regex: `(\d+)일` 추출
  - "1일 (...)" → 1 / "2일" → 2 / 실패 시 NULL

- **`_parse_fee(raw text) RETURNS int`**
  - regex: `\((\d+)원\)` 추출 / 실패 시 NULL

---

### 2-3. `confirm_rental_request(p_request_id, p_game_ids, p_pickup_at, p_duration_days)`

- `is_admin()` 체크
- needs_review → manual_confirmed 전환
- HOLD INSERT (ingest와 동일 로직)
- `reviewed_by = auth.uid()`, `reviewed_at = now()`

---

### 2-4. `reject_rental_request(p_request_id, p_reason)`

- `is_admin()` 체크
- status='rejected', review_note=p_reason

---

## 3. GAS 코드 추가 (Claude가 스니펫 제공, 사용자가 Apps Script 콘솔에서 배포)

기존 onFormSubmit 트리거 끝에 추가:

```javascript
function postToSupabase(e) {
    const values = e.values;  // [timestamp, org_type, org_name, event_overview, ...]

    const payload = {
        _secret: PropertiesService.getScriptProperties().getProperty('SUPABASE_GAS_SECRET'),
        submitted_at: values[0],
        org_type: values[1],
        org_name: values[2],
        event_overview: values[3],
        event_schedule: values[4],
        audience_notes: values[5],
        requested_games_raw: values[6],
        // values[7] = 약관 동의 ("예") — 저장 안 함
        game_count_raw: values[8],
        rental_duration_raw: values[9],
        requester_name: values[10],
        requester_phone: values[11],
        pickup_raw: values[12],
    };

    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/ingest_rental_request', {
        method: 'post',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
        },
        payload: JSON.stringify({ p_payload: payload }),
        muteHttpExceptions: true,
    });
}
```

**Script Properties에 저장할 값:**
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `SUPABASE_GAS_SECRET` (위 RPC의 `_secret` 매칭용 랜덤 문자열)

---

## 4. 관리자 탭 (@scout)

**신규 파일: `src/admin/RentalRequestsTab.jsx`**

- `Admin.jsx`에 탭 추가 (`대여 신청` 같은 라벨)
- 상단 필터: `status` 멀티선택 (기본: needs_review + auto_confirmed)
- 행 표시:
  - 신청자·연락처·제출일
  - 게임 원문 vs 매칭된 게임명 (매칭 실패 토큰은 빨강)
  - 수령일, 기간, 비용, is_free 뱃지
  - 상태 뱃지
- `needs_review` 행: "수정·승인" 버튼 → 모달
  - 게임 선택 드롭다운 (games 전체 목록, multi)
  - 수령일 date-time 피커
  - 기간 선택 (1일/2일/…)
  - [승인] → `confirm_rental_request` RPC
  - [반려] → 메모 입력 → `reject_rental_request` RPC
- `auto_confirmed` 행: 생성된 HOLD 목록 링크 (read-only)

**Admin 다크 테마 변수 사용 (CLAUDE.md 규칙):**
`var(--admin-bg)`, `var(--admin-card-bg)`, `var(--admin-text-main)`, `var(--admin-border)`

---

## 5. `src/api.jsx` 확장

```js
export const fetchRentalRequests = async (statuses = ['needs_review', 'auto_confirmed']) => {
    const { data, error } = await supabase
        .from('rental_requests')
        .select('*')
        .in('status', statuses)
        .order('submitted_at', { ascending: false });
    if (error) throw error;
    return data;
};

export const confirmRentalRequest = (requestId, gameIds, pickupAt, durationDays) =>
    supabase.rpc('confirm_rental_request', {
        p_request_id: requestId,
        p_game_ids: gameIds,
        p_pickup_at: pickupAt,
        p_duration_days: durationDays,
    });

export const rejectRentalRequest = (requestId, reason) =>
    supabase.rpc('reject_rental_request', { p_request_id: requestId, p_reason: reason });
```

---

## 6. 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| 게임명 오타 ("딸무티") | `_fuzzy_match_games`에서 매칭 실패 → needs_review |
| 여러 게임 중 일부만 매칭 | 전체 1:1 매칭 아니면 needs_review (부분 자동 생성 금지) |
| 수령일 파싱 실패 | needs_review |
| 같은 기간 HOLD 중복 (quantity 초과) | ingest RPC에서 감지 → 해당 건만 needs_review 전환, 관리자 확인 |
| 이미 내부 대여 나간 게임에 HOLD 요청 | **자동 생성하되** 대여자에게 반납 독촉은 수동 (범위 외) |
| GAS 재전송 (중복 요청) | `rental_requests.submitted_at + requester_phone + requested_games_raw` 3중 체크로 INSERT 직전 dedupe |
| 행사 취소 | 관리자 탭에서 `status='cancelled'` 설정 시 연결된 HOLD들 `returned_at=now()` 처리 |

---

## 7. 작업 순서

1. **Claude** — 마이그레이션 적용
   - `rental_requests` 테이블 + 인덱스 + RLS
   - `rent_game`/`dibs_game`/`kiosk_rental`/`get_games_with_rentals` active-count 확장
   - `cleanup_expired_dibs`에 HOLD 만료 처리 추가
2. **Claude** — 헬퍼 함수 (`_fuzzy_match_games`, `_parse_*`)
3. **Claude** — `ingest_rental_request` / `confirm_rental_request` / `reject_rental_request` RPC
4. **Claude** — `npm run pull-schema`
5. **Claude** — `src/api.jsx` 함수 추가
6. **@scout** — `RentalRequestsTab.jsx` 구현 + Admin.jsx 탭 등록
7. **Claude** — GAS 스니펫 제공 (사용자가 Apps Script에 배포)
8. **@gemini 리뷰 필수 항목:**
   - `ingest_rental_request`의 `_secret` 공유키 방식 안전성 (대안: Edge Function + Service Role)
   - active-count 확장의 기존 대여 플로우 regression
   - HOLD 생성 race condition (`FOR UPDATE` 필요 여부)
   - RLS 정책 (특히 `rental_requests` INSERT 경로)

---

## 8. 범위 외

- 신청자에게 확정/반려 SMS·메일 자동 발송 (추후 논의 — GAS에서 return 값 보고 전송하는 방식으로 가능)
- 결제 연동 (현장 수동 유지)
- 사용자 페이지에서 "다음 HOLD까지 N일 남음" 표시 (우선순위 낮음)
- Google Form 자체 정형화 (게임 드롭다운 등) — 현재 자유텍스트 유지, 파싱 실패는 needs_review로 흡수

---

## 참고

- `rentals.type`은 text라 enum 변경 없이 `'HOLD'` 추가 가능
- `rentals.user_id`는 이미 NULL 허용 → 외부인 HOLD는 `user_id=NULL + renter_name` 사용
- 기존 GH Action (`cleanup_expired_dibs`, 30분 주기)에 HOLD 만료 정리 한 줄만 추가 — 새 cron 불필요
- HOLD 시작 시각 = `pickup_at - 24h` (확정)
- HOLD 종료 시각 = `pickup_at + duration_days` (보수적으로 일 단위)
