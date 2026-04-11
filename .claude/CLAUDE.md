# Team Management Rules

## 팀 구성
- **Claude** (Architect): 설계, spec 작성, DB 변경, 최종 머지
- **@scout** (Developer): `spec.md` 기반 구현, 룰: `.agent/rules/scout.md` 예정
- **@gemini** (Reviewer): 보안·최적화·문서 리뷰, 룰: `.agent/rules/gem.md`

## 기본 워크플로우
1. Claude가 `spec.md` 작성
2. @scout이 `spec.md` 기반으로 구현
3. @gemini가 구현된 코드 리뷰 (병렬 가능 — 섹션 분할)
4. Claude가 리뷰 결과 반영 후 머지

## 에이전트 호출 가이드

**@scout 호출 시 포함할 것:**
- `spec.md` 또는 구체적 작업 지시
- 수정 대상 파일 경로
- 관련 DB 함수/스키마 요약 (필요 시)

**@gemini 리뷰 요청 시 포함할 것:**
- 변경된 코드 전문 (또는 diff)
- 변경 배경 및 목적
- 리뷰 관점 명시: 보안 / 인증 로직 / DB 설계 / 실용성

**병렬 리뷰 패턴** (대형 작업):
- 섹션 A: DB·RLS·RPC 보안
- 섹션 B: 프론트엔드 로직·UX
- 섹션 C: 성능·코드 품질

## 역할 경계
- DB 스키마/함수/RLS 변경 → **Claude만** (MCP 도구 사용)
- 프론트엔드 구현 → @scout에게 위임 가능
- Claude가 직접 구현할 경우 spec.md 생략 가능

## Gemini 리뷰 트리거 기준

**필수 (반드시 호출):**
- DB 스키마·RLS·RPC 함수 변경
- 인증·인가 로직 변경 (AuthContext, ProtectedRoute, 권한 체크)
- 키오스크·관리자 권한 관련 변경
- 환경변수·보안 관련 변경

**생략 가능:**
- 순수 UI 변경 (레이아웃, 색상, 스타일)
- 텍스트·문구 수정
- 로딩 스피너·애니메이션 등 시각 요소
- 단순 버그 수정 (로직 변경 없는 것)
