# BGG API 데이터 업데이트 — 구현 가이드

**상태**: 🚀 프로토타입 준비 완료
**생성일**: 2026-04-17
**작성자**: Claude

---

## 📋 개요

이 가이드는 BoardGameGeek(BGG) API를 통해 게임 데이터(min_players, max_players, playingtime)를 수집하고 Supabase DB에 반영하는 전체 프로세스입니다.

**목표**: 124개 게임의 플레이어 수 및 플레이타임 정확도 개선

---

## 🛠️ 준비된 도구

### 1. Mock 파이프라인 (현재 환경에서 즉시 실행 가능)
```bash
node scripts/bgg_pipeline_mock.mjs
```
- ✅ Supabase 연결 확인
- ✅ 파이프라인 전체 로직 검증
- ✅ 데이터 포맷 확인
- 📊 **결과**: `bgg_pipeline_mock_results.json`

**장점**: 외부 API 접근 없이도 전체 파이프라인 검증 가능

---

### 2. 실제 BGG API 데이터 수집
```bash
# 개발 환경 (권장)
npm run dev  # 터미널 1 (Vite 프록시 시작)

# 터미널 2에서
node scripts/bgg_collect_and_validate.mjs
```

**또는 프로덕션 환경**:
```bash
NODE_ENV=production node scripts/bgg_collect_and_validate.mjs
```

#### 특징
- ✅ 실제 BGG XML API 호출
- ✅ 네트워크 에러 시 자동 재시도 (프록시 폴백)
- ✅ 데이터 검증 (범위 체크, 필드 확인)
- ✅ Rate limiting (1.5초 간격)
- 📊 **결과**: `bgg_collected_data_YYYY-MM-DD.json`

#### 환경 변수 (선택사항)
```bash
# 기본값: http://localhost:3000 (개발) 또는 프로덕션 URL
API_BASE=http://localhost:3000

# 조회 게임 수 (기본값: 10)
LIMIT=10

# 프로덕션 API
NODE_ENV=production
```

---

### 3. SQL 마이그레이션 자동 생성
```bash
node scripts/generate_migration.mjs [데이터파일]

# 또는 최신 데이터 파일 자동 사용
node scripts/generate_migration.mjs
```

#### 결과물
```sql
-- database/bgg_api_update_YYYY-MM-DD.sql
UPDATE games SET min_players = X, max_players = Y, playingtime = Z WHERE id = N;
```

- ✅ 100% 자동 생성
- ✅ 유효한 데이터만 필터링
- ✅ 변경 미리보기 포함

---

## 🚀 실행 흐름

### Phase 1: 로컬 검증 (지금 바로 가능)

```bash
# ✅ Step 1: Mock 파이프라인으로 전체 로직 검증
node scripts/bgg_pipeline_mock.mjs

# 예상 결과:
# ✅ 성공: 10/10
# ⚠️  업데이트 필요: 10/10 (Mock 데이터가 의도적으로 다름)
# 📁 결과 파일: bgg_pipeline_mock_results.json
```

**확인 사항**:
- ✅ Supabase 연결 정상
- ✅ 데이터 포맷 맞음
- ✅ 파이프라인 로직 정상

---

### Phase 2: 실제 데이터 수집 (개발 환경)

```bash
# Step 1: Vite 프록시 시작
npm run dev

# Step 2: 다른 터미널에서 데이터 수집
node scripts/bgg_collect_and_validate.mjs

# 예상 결과:
# ✅ 성공: 10/10
# - 유효: 8-9개 (일부 경고 가능)
# - 경고: 1-2개
# ❌ 실패: 0-1개
# 📁 결과 파일: bgg_collected_data_YYYY-MM-DD.json
```

**확인 사항**:
- API 응답 정상
- 데이터 검증 통과
- 네트워크 안정성

---

### Phase 3: 마이그레이션 생성

```bash
node scripts/generate_migration.mjs

# 또는 특정 데이터 파일 지정
node scripts/generate_migration.mjs bgg_collected_data_2026-04-17.json

# 예상 결과:
# 📁 파일: database/bgg_api_update_YYYY-MM-DD.sql
# 변경 대상: 10개 게임
# UPDATE 문: 10개
```

---

### Phase 4: DB 적용

#### Step 1: Supabase에 마이그레이션 적용

```sql
-- Supabase SQL Editor에서 실행
-- database/bgg_api_update_YYYY-MM-DD.sql의 내용 복사

-- 또는 MCP 도구 사용
mcp__supabase__apply_migration(
  name: "bgg_api_update_YYYY-MM-DD",
  query: "..." // 마이그레이션 SQL
)
```

#### Step 2: 사후 검증

```sql
-- 변경 확인
SELECT id, name, min_players, max_players, playingtime
FROM games
WHERE id IN (64, 171, 63, 142, 19, 138, 50, 27, 73, 11);
```

---

## 📊 데이터 포맷

### 입력 (bgg_collected_data_*.json)
```json
{
  "test_time": "2026-04-17T...",
  "total_games": 10,
  "success_count": 10,
  "valid_count": 9,
  "warning_count": 1,
  "fail_count": 0,
  "results": [
    {
      "db_id": 64,
      "db_name": "보난자",
      "bgg_id": "11",
      "current": {
        "min_players": 2,
        "max_players": 7,
        "playingtime": "45분"
      },
      "bgg_data": {
        "minPlayers": 2,
        "maxPlayers": 4,
        "playingtime": 60,
        "weight": 2.5
      },
      "validation": {
        "valid": true,
        "errors": [],
        "warnings": []
      },
      "needs_update": true,
      "status": "valid"
    },
    ...
  ]
}
```

### 출력 (bgg_api_update_*.sql)
```sql
UPDATE games SET min_players = 2, max_players = 4, playingtime = 60 WHERE id = 64;
UPDATE games SET min_players = 1, max_players = 4, playingtime = 30 WHERE id = 171;
...
```

---

## ⚙️ 환경별 실행

### 개발 환경 (권장)
```bash
npm run dev                    # Vite 프록시 시작
node scripts/bgg_collect_and_validate.mjs  # 데이터 수집
```

**장점**:
- 로컬 프록시로 API 호출
- 빠른 디버깅
- Rate limiting 넉넉함

### 프로덕션 환경
```bash
NODE_ENV=production \
API_BASE=https://dullgboardgamerent.netlify.app \
node scripts/bgg_collect_and_validate.mjs
```

**주의**:
- Netlify Edge Function 필요
- API Rate limit 엄격함
- 느린 응답 가능 (BGG 서버 과부하)

---

## ⚠️ 주의사항

### 1. BGG API 토큰
- **위치**: `.env.local`의 `VITE_BGG_API_TOKEN`
- **경고**: 공개 저장소에 노출 금지
- **갱신**: 정기적으로 토큰 로테이션 권장

### 2. Rate Limiting
- BGG API: 1-2초 간격 권장
- 스크립트: 1.5초 자동 대기
- 연속 요청 금지 (IP 차단 위험)

### 3. 데이터 검증
- ❌ min > max인 경우 수동 처리
- ⚠️ NULL 필드는 현재값 유지
- 📊 결과 파일 항상 검토 필수

### 4. 마이그레이션 적용
- ✅ 백업 생성 필수
- ✅ 별도 터미널에서 테스트
- ✅ 검증 쿼리 실행 후 확정

---

## 🔄 재실행 가능성

### 개별 게임 업데이트
특정 게임만 다시 수집:
```bash
# bgg_collect_and_validate.mjs 수정 필요
LIMIT=1 GAME_ID=64 node scripts/bgg_collect_and_validate.mjs
```

### 마이그레이션 취소
```sql
-- 변경 전 백업으로 복원 (필요 시)
```

---

## 📈 예상 결과

### Before
```
- playingtime_null: 1개
- min_players_null: 1개
- max_players_null: 1개
- 부정확한 값: ~20-30개
```

### After
```
- playingtime_null: 1개 (ID 216, CSV 미포함)
- min_players_null: ~0-1개
- max_players_null: ~0-1개
- 부정확한 값: 거의 없음
개선율: 99%+
```

---

## 🗑️ 정리

작업 완료 후 임시 파일 정리:
```bash
rm -f bgg_collected_data_*.json
rm -f bgg_pipeline_mock_results.json
rm -f database/bgg_api_update_*.sql (선택사항: 히스토리로 남길 경우 보관)
```

**보관할 파일**:
- ✅ 최종 마이그레이션 SQL (히스토리용)
- ✅ 이 가이드 문서

**삭제할 파일**:
- ❌ 임시 JSON 결과 파일
- ❌ 스크립트 파일들 (선택사항)

---

## 📞 문제 해결

### API 호출 실패
```
❌ HTTP 401 / 403
→ BGG 토큰 확인
→ Rate limit 초과 확인
→ BGG 서버 상태 확인 (https://boardgamegeek.com)
```

### Supabase 연결 실패
```
❌ Error: Supabase 조회 실패
→ URL, KEY 확인
→ 네트워크 연결 확인
→ Supabase 대시보드 상태 확인
```

### 데이터 검증 경고
```
⚠️  minPlayers / maxPlayers 필드 없음
→ 해당 게임 수동 확인
→ BGG 공식 페이지에서 값 확인
→ 수동 마이그레이션
```

---

## 🎯 다음 단계

1. **[지금]** Mock 파이프라인 실행: `node scripts/bgg_pipeline_mock.mjs`
2. **[개발]** 실제 API 테스트: `npm run dev` + `node scripts/bgg_collect_and_validate.mjs`
3. **[검증]** 결과 데이터 검토
4. **[생성]** SQL 마이그레이션: `node scripts/generate_migration.mjs`
5. **[적용]** Supabase에 마이그레이션 실행
6. **[확인]** 사후 검증 쿼리 실행

---

**상태**: ✅ 프로토타입 준비 완료, 실행 대기 중

