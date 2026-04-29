# 행사 시스템 (Event System) — Spec

> 덜지니어스 보드게임 대여 플랫폼에 동아리 행사(예: 할리갈리 학부 대항전)를 통합. **코드 수정 없이 Admin UI만으로 행사 운영이 가능**해야 함 (후임자 인수인계 전제).

---

## 0. 설계 원칙

1. **코드리스 운영**: 한 번 만든 후, 새 행사 추가/운영은 Admin UI만으로 완결
2. **모듈 격리**: 모든 코드는 `src/event/`, DB는 `event_*` 프리픽스 → 미래에 떼어내기 쉬움
3. **빈칸 채우기 폼**: 자유 블록 에디터 X, 정해진 슬롯 채우기
4. **하나의 템플릿**: 모든 행사가 같은 레이아웃 사용, 색상·이미지로만 차별화
5. **자동 결제 안 함**: 계좌이체 + 수동 입금 확인. 단 운영 부담 최소화

---

## 1. 스코프

### IN
- 행사 생성/수정/삭제 (Admin)
- 공개 행사 페이지 (`/event/:slug`)
- 개인/팀 신청
- 회원 등급별 차등 참가비 (정회원 / 준회원 / 비회원)
- 입금 안내 (송금 링크 + 계좌 복사)
- 운영자용 입금 확인·출석 체크·CSV
- 무료 초대 / 운영자 수동 등록 / 정원 관리 / 대기자
- 신청자 마이페이지 노출

### OUT (영원히)
- PG 자동 결제, 자동 환불
- 댓글·게시판
- 자유 블록 에디터
- 분할 결제, 마일리지, 쿠폰

### LATER (구조만 잡고 나중에)
- 얼리버드 가격
- 추가 옵션(티셔츠 등)
- 학부 쿼터
- 추첨 방식

---

## 2. DB 설계

### 2.1 테이블

```sql
-- 행사 메타데이터
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,                    -- URL용, 영문 소문자 + 하이픈
  title text NOT NULL,
  subtitle text,                                -- 한 줄 소개
  status text NOT NULL DEFAULT 'draft',         -- draft|recruiting|closed|ongoing|finished
  hero_image_url text,                          -- Supabase Storage URL
  bg_color text DEFAULT '#1a1a2e',              -- 배경색 (HEX)
  accent_color text DEFAULT '#667eea',          -- 포인트 컬러 (버튼·강조)

  -- 일정
  recruit_start_at timestamptz NOT NULL,
  recruit_end_at timestamptz NOT NULL,
  event_start_at timestamptz NOT NULL,
  event_end_at timestamptz,
  location text,

  -- 정원
  capacity int,                                 -- NULL이면 무제한. 팀 단위면 팀 수, 개인이면 인원 수
  capacity_unit text DEFAULT 'person',          -- person|team
  waitlist_enabled bool DEFAULT true,

  -- 참가 방식
  participation_mode text NOT NULL,             -- individual|team|both
  team_size_min int,                            -- 팀 참가 시
  team_size_max int,

  -- 가격 정책 (JSON: 미래 확장 대비)
  -- 예: { "base": { "paid_member": 5000, "member": 8000, "non_member": 10000 },
  --       "early_bird": null, "options": [], "team_discount": null }
  pricing jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 결제 안내
  account_bank text,                            -- 예: "토스뱅크"
  account_number text,                          -- 예: "1000-1234-5678"
  account_holder text,                          -- 예: "홍길동(덜지니어스)"
  toss_send_url text,                           -- supertoss://...
  kakaopay_send_url text,                       -- https://qr.kakaopay.com/...
  payment_deadline_hours int DEFAULT 48,        -- 신청 후 N시간 내 미입금 시 자동 만료

  -- 콘텐츠 슬롯 (자유 텍스트)
  description text,                             -- 본문 (마크다운/줄바꿈)
  schedule_items jsonb DEFAULT '[]'::jsonb,     -- [{time, content}]
  faq_items jsonb DEFAULT '[]'::jsonb,          -- [{q, a}]
  prize_text text,                              -- 상금/혜택
  refund_policy text,                           -- 환불 정책 (자유 텍스트)
  extra_images jsonb DEFAULT '[]'::jsonb,       -- 추가 이미지 URL 배열

  -- 신청 폼 추가 질문 (행사별 커스텀)
  -- 예: [{ "key": "cheer_dept", "label": "응원 학부", "type": "text", "required": true }]
  extra_questions jsonb DEFAULT '[]'::jsonb,

  -- 동의 항목
  require_privacy_consent bool DEFAULT true,
  require_photo_consent bool DEFAULT false,

  -- 메타
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 팀 (팀 참가 시)
CREATE TABLE public.event_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_name text NOT NULL,
  invite_code text UNIQUE NOT NULL,             -- 예: "ABCD-1234"
  leader_user_id uuid NOT NULL REFERENCES profiles(id),
  size_target int NOT NULL,                     -- 팀장이 입력한 목표 인원
  status text NOT NULL DEFAULT 'forming',       -- forming|complete|cancelled
  created_at timestamptz DEFAULT now(),
  UNIQUE(event_id, team_name)
);

-- 신청 (개인 1건 = 1 row, 팀이면 팀원마다 1 row)
CREATE TABLE public.event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id uuid REFERENCES event_teams(id) ON DELETE CASCADE,  -- NULL이면 개인 참가
  user_id uuid REFERENCES profiles(id),         -- 비로그인 신청 허용 시 NULL 가능 (현재는 NOT NULL로 시작)

  -- 신청 시점의 정보 스냅샷 (회원 정보 변경되어도 보존)
  applicant_name text NOT NULL,
  applicant_student_id text,
  applicant_phone text,
  membership_tier text NOT NULL,                -- paid_member|member|non_member|invited

  -- 가격
  fee_amount int NOT NULL DEFAULT 0,            -- 실제 청구 금액
  is_invited bool DEFAULT false,                -- 무료 초대 여부

  -- 상태
  status text NOT NULL DEFAULT 'pending',
  -- pending(입금대기) | paid(입금확인) | waitlisted(대기자)
  -- | cancelled_unpaid(미입금만료) | cancelled_self(본인취소)
  -- | cancelled_admin(운영취소) | refunded(환불) | no_show(노쇼)

  -- 결제
  payment_deadline_at timestamptz,              -- 입금 마감
  payment_received_at timestamptz,
  expected_depositor_name text,                 -- 예상 입금자명: "행사명_홍길동"
  actual_depositor_name text,                   -- 실제 입금자명 (대리결제 등)

  -- 추가 정보
  extra_answers jsonb DEFAULT '{}'::jsonb,      -- extra_questions 응답
  privacy_consent_at timestamptz,
  photo_consent bool DEFAULT false,

  -- 출석
  checked_in_at timestamptz,

  -- 메타
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  cancelled_at timestamptz,
  cancel_reason text,

  UNIQUE(event_id, user_id)                     -- 중복 신청 방지 (같은 user_id가 같은 행사 두 번 X)
);

-- 입금 처리 로그 (감사 추적)
CREATE TABLE public.event_payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
  action text NOT NULL,                         -- mark_paid|unmark|refund|invite|cancel
  amount int,
  note text,
  performed_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

-- 인덱스
CREATE INDEX idx_events_slug ON events(slug);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_event_regs_event ON event_registrations(event_id, status);
CREATE INDEX idx_event_regs_user ON event_registrations(user_id);
CREATE INDEX idx_event_teams_invite ON event_teams(invite_code);
```

### 2.2 RLS 정책

```sql
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_payment_logs ENABLE ROW LEVEL SECURITY;

-- events: 공개된 것은 누구나 읽기, draft는 admin만
CREATE POLICY "events_public_read" ON events FOR SELECT
  USING (status != 'draft' OR is_admin());
CREATE POLICY "events_admin_write" ON events FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- event_teams: 같은 행사 참가자/팀장/admin만 읽기
CREATE POLICY "event_teams_read" ON event_teams FOR SELECT
  USING (
    is_admin()
    OR leader_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM event_registrations r
      WHERE r.team_id = event_teams.id AND r.user_id = auth.uid()
    )
  );
CREATE POLICY "event_teams_create" ON event_teams FOR INSERT
  WITH CHECK (auth.uid() = leader_user_id);
CREATE POLICY "event_teams_admin_write" ON event_teams FOR UPDATE
  USING (is_admin() OR leader_user_id = auth.uid());

-- event_registrations: 본인/팀장/admin만 읽기
CREATE POLICY "event_regs_self_read" ON event_registrations FOR SELECT
  USING (
    is_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM event_teams t
      WHERE t.id = event_registrations.team_id AND t.leader_user_id = auth.uid()
    )
  );
-- 신청은 RPC로만 (직접 INSERT 차단)
CREATE POLICY "event_regs_admin_write" ON event_registrations FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- event_payment_logs: admin만
CREATE POLICY "event_payment_logs_admin" ON event_payment_logs FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());
```

### 2.3 RPC 함수

```sql
-- 신청 (개인)
event_register_individual(p_event_id, p_extra_answers, p_photo_consent)
  → 회원 등급 자동 판정 (profiles.is_paid + last_paid_semester)
  → 정원/마감/중복/자격 체크
  → fee_amount 계산
  → expected_depositor_name 생성 (예: "할리갈리_홍길동")
  → payment_deadline_at = now() + payment_deadline_hours
  → 정원 초과 시 waitlisted로 등록 (waitlist_enabled=true일 때)

-- 팀 생성 + 팀장 신청
event_create_team(p_event_id, p_team_name, p_size_target, p_extra_answers, p_photo_consent)
  → invite_code 발급 (8자리)
  → 팀장 본인 registration 생성

-- 팀 합류
event_join_team(p_invite_code, p_extra_answers, p_photo_consent)
  → 팀 정원 체크
  → registration 생성

-- 신청 취소 (본인)
event_cancel_my_registration(p_registration_id, p_reason)

-- 입금 확인 (admin)
event_mark_paid(p_registration_id, p_actual_depositor_name)
  → status = 'paid', payment_received_at = now()
  → 로그 기록

-- 무료 초대 (admin)
event_invite_user(p_event_id, p_user_id, p_note)
  → fee_amount=0, is_invited=true, status='paid'

-- 운영자 수동 등록 (admin) — 비회원·현장등록용
event_admin_register(p_event_id, p_name, p_phone, p_student_id, p_membership_tier, p_team_id)

-- 출석 체크 (admin)
event_check_in(p_registration_id)

-- 미입금 자동 만료 (cron 또는 호출)
event_expire_unpaid()
  → payment_deadline_at < now() AND status='pending'인 것 모두 cancelled_unpaid 처리
  → 대기자 1명 자동 승계 (waitlisted → pending, 새 deadline 부여)
```

### 2.4 회원 등급 판정 로직

```sql
CREATE OR REPLACE FUNCTION resolve_membership_tier(p_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_current_semester text;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN 'non_member'; END IF;

  -- 현재 학기 (app_config에서 읽기)
  SELECT value::text INTO v_current_semester FROM app_config WHERE key = 'current_semester';

  -- 정회원: 현재 학기 회비 납부
  IF v_profile.is_paid AND v_profile.last_paid_semester = v_current_semester THEN
    RETURN 'paid_member';
  END IF;

  -- 준회원: 가입했지만 회비 미납
  RETURN 'member';
END;
$$;
```

---

## 3. 프론트엔드 설계

### 3.1 라우트 추가 (`src/App.jsx`)
```
/event/:slug         → EventPage (공개)
/event/:slug/apply   → EventApplyPage (로그인 필요)
/event/team/:code    → EventJoinTeamPage (로그인 필요)
```

### 3.2 컴포넌트 구조 (`src/event/`)
```
src/event/
├── EventPage.jsx              # 공개 페이지 (히어로, 일정, FAQ, 신청 버튼)
├── EventPage.css
├── EventApplyPage.jsx         # 신청 폼 (개인/팀 분기)
├── EventTeamJoinPage.jsx      # 팀 초대코드로 합류
├── components/
│   ├── EventHero.jsx          # 배경색·이미지 적용 헤더
│   ├── EventPricingCard.jsx   # 회원 등급별 가격 + 가입 유도
│   ├── EventScheduleList.jsx
│   ├── EventFaqList.jsx
│   ├── EventApplyButton.jsx   # 상태별 버튼 (모집중/마감/이미신청 등)
│   ├── EventPaymentGuide.jsx  # 송금 링크 + 계좌 복사
│   └── EventExtraQuestions.jsx
└── api_events.jsx             # Supabase 호출 레이어
```

### 3.3 Pricing 표시 로직 (`EventPricingCard`)

| 사용자 상태 | 표시 |
|-------------|------|
| 비로그인 | "참가비 10,000원 / 덜지 회원은 5,000원 [로그인]" |
| 로그인 + 비회원 | "10,000원 / 회원이면 5,000원 [회원가입]" |
| 로그인 + 준회원 | "8,000원 / 회비 납부 시 5,000원 [납부 안내]" |
| 로그인 + 정회원 | "5,000원 ✓ 회원 할인 적용됨" |
| 로그인 + 무료초대 | "무료 초대 ✓" |

### 3.4 마이페이지 통합
`MyPage.jsx`에 "내 행사 신청" 섹션 추가 — 신청 내역, 입금 상태, 취소 버튼.

### 3.5 신청 흐름

**개인 신청:**
1. `/event/:slug` → "신청하기" 클릭
2. (비로그인 시) `/login`으로 보낸 후 복귀
3. `/event/:slug/apply` → 추가 질문 + 동의 + 제출
4. 제출 후 → 결제 안내 화면 (송금 링크, 계좌, 입금자명, 마감)

**팀 신청 (팀장):**
1. 동일 흐름 + 팀명·인원 입력
2. 제출 후 → 초대 코드 발급 화면 (공유 버튼)

**팀 합류 (팀원):**
1. `/event/team/:code` 또는 코드 직접 입력
2. 추가 질문 + 동의 + 제출
3. 결제 안내 (개인별 입금)

---

## 4. Admin UI 설계

### 4.1 새 탭 추가 (`Admin.jsx`)
```
🎪 행사 관리 (id: events)
```

### 4.2 컴포넌트 (`src/admin/events/`)
```
src/admin/EventsTab.jsx              # 탭 진입점 (행사 목록)
src/admin/events/
├── EventListView.jsx                # 행사 목록 + "새 행사" / "복제" 버튼
├── EventEditForm.jsx                # 생성·수정 폼 (전 필드)
├── EventRegistrationsView.jsx       # 신청자 명단 (필터·검색)
├── EventPaymentReconcile.jsx        # 입금 확인 화면
├── EventCheckInView.jsx             # 당일 출석 체크 (학번 검색)
└── EventCsvExport.jsx               # CSV 내보내기
```

### 4.3 EventEditForm 필드 그룹

```
[기본 정보]
  행사명, 슬러그(영문 소문자+하이픈, 검증), 한 줄 소개, 상태 dropdown

[디자인]
  대표 이미지 업로드, 배경색 컬러피커, 포인트색 컬러피커, 추가 이미지 N개

[일정·장소]
  모집 시작/종료, 행사 시작/종료, 장소

[정원]
  정원 숫자, 단위(인원/팀), 대기자 허용 토글

[참가 방식]
  방식 라디오(개인/팀/둘다), 팀 인원 min/max

[가격]
  정회원/준회원/비회원 참가비

[결제 안내]
  은행, 계좌번호, 예금주, 토스 링크, 카카오페이 링크, 입금 마감(시간)

[콘텐츠]
  본문(텍스트), 일정(반복행: 시간+내용), FAQ(반복행: Q+A), 상금 안내, 환불 정책

[추가 질문]
  반복행: 키, 라벨, 타입(text/select/checkbox), 필수 여부

[동의 항목]
  개인정보 수집(기본 필수), 사진 게시(선택)
```

### 4.4 EventRegistrationsView 컬럼
```
이름 | 학번 | 등급 | 팀 | 금액 | 상태 | 입금자명(예상/실제) | 출석 | 액션
```
- 필터: 상태별, 팀별, 회원 등급별
- 일괄 액션: 선택 → 입금 확인, 취소
- 행 액션: 수동 등록, 무료 초대, 환불, 삭제

### 4.5 EventPaymentReconcile (입금 매칭 보조)
- "입금 내역 텍스트 붙여넣기" 영역
- 파싱 규칙: 줄별로 (입금자명, 금액) 추출
- 자동 매칭 결과 표 → 운영자 확인 후 일괄 처리
- v1에서는 수동 체크만, 텍스트 매칭은 v2

### 4.6 행사 복제
"새 행사" 버튼 옆 "복제" 버튼 → 기존 행사 선택 → 슬러그·날짜만 비워서 새 폼 열기

---

## 5. Storage

Supabase Storage 버킷 `event-images` 생성:
- 정책: admin만 업로드, 누구나 읽기
- 경로: `event-images/{event_id}/{uuid}.{ext}`

---

## 6. 구현 단계 (Phase)

| Phase | 내용 | 산출물 |
|-------|------|--------|
| 1 | DB 스키마·RLS·RPC + Storage 버킷 | _LIVE 동기화, 마이그레이션 적용 |
| 2 | 공개 행사 페이지 + 신청 흐름 (개인/팀) + MyPage 통합 | `src/event/` |
| 3 | Admin 행사 관리 탭 (생성·수정·신청자·입금·출석·CSV) | `src/admin/events/` |
| 4 | Gemini 보안 리뷰 → 반영 | 리뷰 결과 + 패치 |
| 5 | (Optional) `event_expire_unpaid` 자동화 (Supabase Cron) | cron job |

---

## 7. 보안·권한 체크리스트

- [ ] 모든 RPC `SECURITY DEFINER` 사용 시 권한 함수로 가드
- [ ] `is_admin()` 사용 (kiosk 제외)
- [ ] 신청 RPC는 본인 user_id 강제 (auth.uid() 사용)
- [ ] Admin RPC는 `is_admin()` 첫 줄 체크
- [ ] `event_admin_register`처럼 운영자가 타인 등록하는 RPC는 `created_by` 로그
- [ ] `extra_answers`는 jsonb이지만 size 제한 (예: 8KB)
- [ ] 슬러그 정규식 검증 (DB CHECK + 프론트)
- [ ] 입금 확인 액션은 모두 `event_payment_logs`에 기록

---

## 8. 후임자 운영 시나리오 (검증용)

1. **새 행사 만들기**: 행사관리 탭 → "새 행사" → 폼 채우기 → 저장 → "공개" 토글
2. **작년 행사 복제**: "복제" → 슬러그·날짜만 수정 → 저장
3. **신청자 확인**: 행사 클릭 → 신청자 명단 → CSV 다운로드
4. **입금 체크**: 은행 앱과 명단 비교 → 행마다 "입금완료" 클릭
5. **무료 초대**: 학번 검색 → "초대" 버튼
6. **당일 출석**: 출석 탭 → 학번 입력 → 체크
7. **행사 종료**: 상태 dropdown → "종료"

각 시나리오가 코드 수정 없이 가능해야 함.

---

## 9. 확정 사항

- 비로그인 신청 **차단** → `event_registrations.user_id NOT NULL`
- 정회원 판정: **`profiles.is_paid = true` 만** (OB 회원 포함 위해 학기 체크 X)
- 이미지 업로드: **Supabase Storage `event-images` 버킷**
- 미입금 만료: **수동** (Admin "미입금 만료 처리" 버튼)
- Soft delete: **도입** — `events.deleted_at timestamptz` (hard delete 금지)
- `updated_at` 자동 갱신 트리거: **ON** (events, event_registrations)

## 10. resolve_membership_tier 단순화 버전

```sql
CREATE OR REPLACE FUNCTION resolve_membership_tier(p_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE v_is_paid bool;
BEGIN
  SELECT is_paid INTO v_is_paid FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN 'non_member'; END IF;
  IF v_is_paid THEN RETURN 'paid_member'; END IF;
  RETURN 'member';
END;
$$;
```

---

## 11. 가격 등급 운영 정책 (3-tier UI ↔ 4-tier DB)

### 11.1 결정
- **DB membership_tier**: `paid_member | member | non_member | walk_in | invited` (5종)
- **UI 노출**: `정회원 / 비회원 / 현장결제` 3개 (회원가입·납부 유도용 홍보 카드)
- **member ↔ non_member 가격 매핑**: `_event_calc_fee`에서 `member` 조회 시 `non_member` 가격 fallback
  - 즉, pricing JSON은 `{paid_member, non_member, walk_in}` 3개만 채우면 됨
  - 회원가입했지만 회비 미납인 `member` 사용자도 비회원 가격을 그대로 청구
- **walk_in**: 현장 미가입자용. 운영자가 현장에서 `event_admin_register`로 등록
  - 보통 "현장 와서 가입하면 비회원 가격으로 해 줄게" 유도용
  - **인원 칼같이 지켜야 하는 행사**: `events.allow_walk_in=false`로 차단

### 11.2 events.allow_walk_in
- `bool NOT NULL DEFAULT true`
- `false`이면 `event_admin_register(p_membership_tier='walk_in')` 호출 시 `walk_in_not_allowed` 예외
- Admin UI에서 토글 (디폴트 ON)

### 11.3 가격 폼 입력 필드 (Admin)
```
정회원 참가비:    [    ] 원   → pricing.base.paid_member
비회원 참가비:    [    ] 원   → pricing.base.non_member  (member도 이 가격)
현장결제 참가비:  [    ] 원   → pricing.base.walk_in
[ ] 현장결제(walk-in) 허용  → events.allow_walk_in
```

---

## 12. 이미지 업로드·변환 정책

### 12.1 업로드 한도
- 모바일 사용자(운영자) 부담 줄이기 위해 **개별 파일 한도는 느슨하게** (~10MB)
- 행사당 누적 한도: hero 1장 + extra_images 최대 5장 = 60MB 상한 (실제로는 거의 안 닿음)

### 12.2 서버 측 변환
- Supabase Storage **Image Transformation** 사용 (`?width=...&quality=...`)
- 표시 시점에 변환 URL을 만들어 사용:
  - hero: `width=1200, quality=80`
  - thumbnail: `width=400, quality=70`
  - extra_images: `width=800, quality=80`
- 원본은 Storage에 그대로 보관, 클라이언트에서 압축 X

### 12.3 버킷
- `event-images` (이미 생성)
- 정책: admin INSERT/UPDATE/DELETE, public read는 URL 직접 접근으로 처리 (SELECT 정책 X — 버킷 listing 차단)

