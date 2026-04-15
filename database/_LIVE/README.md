# database/current/

Supabase 현재 배포 상태를 자동으로 끌어온 파일들입니다.
**직접 수정하지 마세요** — `node scripts/pull_schema.js` 로 갱신됩니다.

## 파일 목적

| 파일 | 내용 | AI 활용 시점 |
|------|------|-------------|
| `functions.sql` | 모든 RPC 함수 (바디 포함) | 함수 로직 파악, 버그 수정 |
| `schema.sql`    | 모든 테이블 + 컬럼 정의  | 쿼리 작성, 관계 파악 |
| `rls.sql`       | 모든 RLS 정책            | 보안/권한 문제 디버깅 |
| `types.sql`     | 커스텀 Enum 타입         | 타입 관련 작업 |

## 마지막 갱신

- 시각: 2026. 4. 15. PM 2:49:03
- 프로젝트: hptvqangstiaatdtusrg
- 함수: 36개 / 테이블: 14개

## 갱신 방법

```bash
npm run pull-schema
```
