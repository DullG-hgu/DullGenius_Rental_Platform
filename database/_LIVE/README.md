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
| `grants.sql`    | anon/authenticated 실효 권한 (함수 EXECUTE·테이블·컬럼) | 권한 회귀 점검, 비회원 노출 면 확인 |

## 마지막 갱신

- 시각: 2026. 9. 6. PM 6:47:03
- 프로젝트: hptvqangstiaatdtusrg
- 함수: 90개 / 테이블: 20개

## 갱신 방법

```bash
npm run pull-schema
```
