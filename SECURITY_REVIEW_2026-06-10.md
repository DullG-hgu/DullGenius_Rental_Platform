# 덜지니어스 보드게임 대여 시스템 — 보안 점검 리포트

- **점검일**: 2026-06-10
- **대상 프로젝트**: Supabase `hptvqangstiaatdtusrg` (https://hptvqangstiaatdtusrg.supabase.co)
- **점검 범위**: DB/RLS/RPC · 인증 로직 · 시크릿/설정 · 스토리지
- **점검 방법**: Supabase MCP(advisor, RLS·함수 정의, 라이브 권한/데이터 조회) + 프론트엔드 인증 코드 리뷰
- **참고**: 모든 테이블에 RLS는 활성화되어 있음(21개 테이블). 아래는 정책·함수 **내용**의 문제.

---

## 적용 현황 (2026-06-10)

마이그레이션 `security_hardening_2026_06_10` 적용 완료 — 조치 **1·2·4·5 해결**, 3번은 보류.
콜패스 추적으로 키오스크·마이페이지·대여/반납 무영향 확인 후 적용. 라이브 검증 완료, `_LIVE` 동기화 완료.

| # | 조치 | 상태 |
|---|------|------|
| 1 | `earn_points` 외부 EXECUTE 회수 | ✅ 적용 (외부 grant 없음 확인) |
| 2 | `app_config` 인증자 쓰기 정책 제거 | ✅ 적용 (쓰기 `is_admin`만) |
| 4 | `logs` 공개 읽기 정책 제거 | ✅ 적용 (읽기 `is_admin`만) |
| 5 | `game-images` 쓰기 관리자 전용화 | ✅ 적용 (`game_images_admin_write`) |
| 6 | 중복·과다 PERMISSIVE 정책 정리 | ✅ 적용 (2026-06-16 `rls_dedupe_permissive_policies_2026_06_16`, 정책 21개 제거 → 동작 보존) |
| 3 | `reset_own_password` 강화 | 🟢 위험 수용 (동아리 규모, 2026-06-16 결정) |

---

## 요약 (심각도순)

| # | 항목 | 심각도 | 한 줄 요약 |
|---|------|--------|-----------|
| 1 | `earn_points` RPC 무권한 노출 | 🔴 High → ✅ | 로그인한 누구나 자신/타인 포인트 무제한 적립 |
| 2 | `app_config` 인증자 쓰기 허용 | 🔴 High → ✅ | 모든 로그인 사용자가 운영 설정 변조 + 저장형 XSS 가능성 |
| 3 | `reset_own_password` 지식기반 인증 | 🔴 High | 학번+이름+전화만으로 비번 재설정 → 계정 탈취 |
| 4 | `logs` 전체 공개 읽기 | 🔴 High → ✅ | 비로그인자가 7,303건 활동 로그 전체 열람(개인정보) |
| 5 | `game-images` 버킷 쓰기/삭제 개방 | 🟠 Medium → ✅ | 로그인한 누구나 게임 이미지 업로드·덮어쓰기·삭제 |
| 6 | 중복·과다 PERMISSIVE 정책 | 🟠 Medium → ✅ | OR 결합으로 가장 느슨한 정책이 적용 → 사고·감사난이도 (2026-06-16 정리) |
| 7 | 활성 대여 공개 + `renter_name` 노출 | 🟡 Low | 의도된 정책이나 실명 노출 재검토 권고 |
| 8 | 유출 비밀번호 보호 비활성 | 🟡 Low | HaveIBeenPwned 체크 꺼짐 |
| 9 | 기타(에러 메시지 노출, 고정 임시비번 등) | 🟡 Low | 정보 노출·예측 가능 비밀번호 |
| 10 | 성능 advisor(RLS initplan/인덱스) | ℹ️ Info | 보안 아님, 확장성 개선 권고 |

---

## 🔴 1. `earn_points` — 무권한 포인트 적립 (데이터 무결성)

**근거**
- `earn_points(p_user_id, p_amount, p_type, p_reason)`는 `SECURITY DEFINER`이며 **권한 체크가 전혀 없음**.
- 라이브 권한 확인 결과 `authenticated` 롤에 `EXECUTE`가 부여되어 REST(`/rest/v1/rpc/earn_points`)로 직접 호출 가능.

```sql
-- 함수 본문 (database/_LIVE/functions.sql:739)
INSERT INTO point_transactions (user_id, amount, type, reason) VALUES (p_user_id, p_amount, ...);
UPDATE profiles SET current_points = COALESCE(current_points,0) + p_amount WHERE id = p_user_id;
```

**영향**: 로그인한 임의 사용자가
`supabase.rpc('earn_points', { p_user_id: <내 id>, p_amount: 9999999, ... })`
호출로 자신(또는 타인)의 포인트를 무제한 조작. 포인트가 보상/혜택과 연동되면 직접적 부정이득.

**권고**
- 이 함수는 **내부 호출 전용**(`kiosk_return`, `register_match_result`에서만 사용)이므로 외부 EXECUTE 회수:
  ```sql
  REVOKE EXECUTE ON FUNCTION public.earn_points(uuid,integer,text,text) FROM authenticated, anon, public;
  ```
- 호출하는 상위 함수들이 `SECURITY DEFINER`라 회수해도 정상 동작함.

---

## 🔴 2. `app_config` — 모든 로그인 사용자가 운영 설정 변조

**근거**: `app_config`에 아래 정책이 공존.
```sql
CREATE POLICY "Allow authenticated insert/update" ON public.app_config
  FOR ALL TO public
  USING  (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');   -- INSERT/UPDATE/DELETE 모두 허용
```
PERMISSIVE 정책은 OR로 결합되므로 `is_admin()` 정책이 따로 있어도 **이 정책 하나로 모든 인증 사용자에게 쓰기가 열림**.

**영향**
- `app_config` 내용: `office_status`(영업중 여부), `payment_check_enabled`, `office_hours_config`, `recommendations`(홈 화면 추천 버튼). 라이브 확인됨.
- 임의 사용자가 영업 상태/회비 체크 플래그를 토글하거나 추천 버튼을 변조 가능.
- 특히 `recommendations`의 `label`은 홈 화면에 렌더링되므로, 값에 마크업/스크립트를 주입하면 **저장형 XSS** 가능성(프론트 렌더링 방식 추가 확인 필요).

**권고**
- 인증자 쓰기 정책 제거, 쓰기는 관리자에게만:
  ```sql
  DROP POLICY "Allow authenticated insert/update" ON public.app_config;
  -- 남길 것: "Admin Manage Config"(is_admin) + 읽기 전용 public SELECT
  ```
- 중복 SELECT 정책("Allow public read access" / "Public Read Config")은 하나로 정리.

---

## 🔴 3. `reset_own_password` — 지식기반 인증으로 계정 탈취

**근거**: `anon`+`authenticated` 모두 호출 가능(라이브 확인). 인증 수단이 **학번+이름+전화번호 일치**뿐.
```sql
SELECT id INTO v_user_id FROM public.profiles
 WHERE student_id=p_student_id AND name=p_name
   AND REPLACE(phone,'-','')=REPLACE(p_phone,'-','');
-- 일치 시 auth.users.encrypted_password 를 새 값으로 덮어씀
```

**영향**: 학번·이름·전화는 동아리 구성원 사이에서 충분히 알 수 있는 정보. 이 3가지를 아는 사람이 **임의 계정의 비밀번호를 재설정**해 탈취 가능. 시도 횟수 제한·레이트리밋·알림이 없어 무차별 대입에도 노출.

**권고(택1 이상)**
- 가능하면 Supabase 표준 **이메일 비밀번호 재설정 링크**로 전환(소유 증명 기반).
- 유지해야 한다면: 재설정 후 **해당 이메일로 통지 발송**, 동일 IP/대상 **레이트리밋**, 실패 로깅·잠금, 전화번호 외 추가 요소(예: 가입 이메일 입력) 요구.
- `EXCEPTION WHEN OTHERS ... SQLERRM` 그대로 반환은 내부 오류 노출이므로 일반 메시지로 마스킹.

---

## 🔴 4. `logs` — 활동 로그 전체 공개 읽기 (개인정보 노출)

**근거**
```sql
CREATE POLICY "Public Read Logs" ON public.logs FOR SELECT TO public USING (true);
```
`Admin View Logs`(is_admin)와 무관하게 위 정책으로 **anon 포함 전원**이 `logs` 전체(현재 7,303건) 조회 가능.

**영향**: `user_id`(UUID), `game_id`, `action_type`, `details` 노출. 액션에는 `RENT`/`DIBS`/`RETURN`뿐 아니라 `SELF_RESET_PW`, `ADMIN_RESET_PW`, `SECURITY_ALERT` 등이 포함되어, **누가 무엇을 빌렸는지·비밀번호를 재설정했는지**까지 외부에서 추적 가능. 개인정보·행동 프로파일링 노출.

**권고**
```sql
DROP POLICY "Public Read Logs" ON public.logs;
-- 읽기는 is_admin 정책만 유지. 익명 INSERT(VIEW/SEARCH 등 분석 로그)가 필요하면
-- "FOR INSERT TO public WITH CHECK (true)" 정책만 별도로 두고 SELECT는 막을 것.
```
- 익명 분석 로그 적재가 목적이라면 INSERT만 허용하고 SELECT는 관리자 한정으로 분리.

---

## 🟠 5. `game-images` 스토리지 버킷 — 임의 사용자 쓰기/삭제

**근거**: `storage.objects` 정책에서 `authenticated` 롤에 `game-images` 버킷의 **INSERT/UPDATE/DELETE**가 모두 부여됨(라이브 확인). 또한 공개 버킷이라 anon 목록 조회 가능(advisor `public_bucket_allows_listing`).

**영향**: 로그인한 임의 사용자가 게임 이미지를 업로드·**덮어쓰기·삭제**해 화면 변조(디페이스먼트)나 부적절 이미지 삽입 가능.

**권고**: 쓰기/수정/삭제를 관리자(`is_admin()`)로 제한. 읽기만 공개 유지. (이미 `event-images`는 `is_admin()`으로 제한되어 있어 동일 패턴 적용 권장.)

---

## 🟠 6. 중복·과다 PERMISSIVE 정책

**근거**: advisor `multiple_permissive_policies` 148건. 예) `games` 공개읽기 정책 5개, `rentals` 8개, `damage_reports`/`game_requests` 각 6개. 의미 중복이 많음.

**영향**: PERMISSIVE 정책은 **OR**로 합쳐지므로, 의도치 않게 추가된 느슨한 정책 하나가 전체를 개방함(위 2·4번이 정확히 이 패턴). 정책이 많을수록 실수·감사 난이도 증가.

**권고**: 테이블별로 정책을 1개 역할군당 1개로 정리(읽기/본인/관리자). 특히 같은 조건의 중복(`Public Read` vs `Public Read Games` 등)은 통합.

---

## 🟡 7. 활성 대여 공개 + 실명 노출

`rentals`의 `Public view active rentals` (`USING returned_at IS NULL`)로 anon이 활성 대여 행을 조회 가능. 메모리상 *A안(활성 대여만 공개, 종료 이력 차단)*으로 **의도된 결정**이나, 행에 `renter_name`(실명)이 포함되면 외부에 실명 노출됨. 공개가 꼭 필요한 컬럼만 뷰로 제한하거나 이름 마스킹 권고.

## 🟡 8. 유출 비밀번호 보호 비활성

advisor `auth_leaked_password_protection`: HaveIBeenPwned 대조가 꺼져 있어 유출된 약한 비밀번호 사용 허용. Supabase Auth 설정에서 활성화 권장.

## 🟡 9. 기타 Low

- `reset_user_password`(관리자용)는 비밀번호를 고정 문자열 `'12345678'`로 초기화 → 예측 가능. 1회용 랜덤값 + 강제 변경 유도 권장.
- `reset_own_password` / 일부 함수의 `EXCEPTION ... SQLERRM` 노출(정보 누출).
- `ingest_rental_request`는 anon 노출이나 `private_config`의 공유 시크릿으로 보호됨(수용). 단 레이트리밋 부재 — 폼 스팸 대비 권고.
- `allowed_users`는 RLS만 켜고 정책이 없어 사실상 deny-all(안전). 의도된 상태인지 확인.

## ℹ️ 10. 성능(advisor, 보안 아님)

- `auth_rls_initplan` 32건: 정책 내 `auth.uid()`를 `(select auth.uid())`로 감싸 행마다 재평가 방지.
- `unindexed_foreign_keys` 9건, `duplicate_index` 1건(`rentals`의 `idx_rentals_returned_at`/`idx_rentals_status` 중복), `unused_index` 5건.

---

## 인증 코드(프론트) 검토 결과

`src/contexts/AuthContext.jsx`는 양호. 로그아웃 시 in-flight fetch 무효화(`fetchGenRef`), kiosk 계정의 profiles 부재 분기, JWT 자연 만료 + RLS 의존 설계가 적절. **권한 판정은 클라이언트 `hasRole`이 아니라 DB RLS/`is_admin()`에 의존**하고 있어 구조적으로 올바름 — 따라서 위 1~5번처럼 **서버측 정책/함수 권한**이 실제 방어선이며, 거기서의 누수가 핵심 리스크.

---

## 우선 조치 순서 (권장)

1. **즉시(High)**: `earn_points` EXECUTE 회수 → `app_config` 인증자 쓰기 정책 제거 → `logs` 공개읽기 제거 → `reset_own_password` 통지/레이트리밋(또는 표준 재설정 전환).
2. **단기(Medium)**: `game-images` 쓰기/삭제 관리자 제한, 중복 정책 정리.
3. **개선(Low/Info)**: 유출비번 보호 활성화, 고정 임시비번 제거, RLS initplan/인덱스 최적화.

> 비고: 본 리포트는 점검만 수행했고 **DB 변경은 적용하지 않았습니다.** 1·2번 항목의 마이그레이션 적용을 원하시면 회귀 영향(특히 익명 분석 로그 INSERT 경로, 추천 버튼 편집 UI)을 확인한 뒤 진행하겠습니다.
