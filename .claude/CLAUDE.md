# Team Management Rules

## 팀 구성
- **Claude** (Architect): 설계, spec 작성, DB 변경, 최종 머지
- **@scout** (Developer): `spec.md` 기반 구현, 룰: `.agent/rules/scout.md` 예정

## 기본 워크플로우
1. Claude가 `spec.md` 작성
2. @scout이 `spec.md` 기반으로 구현
3. 구현 전 트레이드오프·부작용 보고 → 사용자 확인 후 적용

## 에이전트 호출 가이드

**@scout 호출 시 포함할 것:**
- `spec.md` 또는 구체적 작업 지시
- 수정 대상 파일 경로
- 관련 DB 함수/스키마 요약 (필요 시)

## 역할 경계
- DB 스키마/함수/RLS 변경 → **Claude만** (MCP 도구 사용)
- 프론트엔드 구현 → @scout에게 위임 가능
- Claude가 직접 구현할 경우 spec.md 생략 가능
