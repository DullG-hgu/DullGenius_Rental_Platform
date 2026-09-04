---
name: playwright-mcp
description: 로그인이 필요한 화면(관리자·키오스크 등)을 자격증명 없이 브라우저로 재현·검증한다. 사용자의 Chrome에 확장 브릿지로 붙는 Playwright MCP 서버를 띄우는 절차와, 세션 시작 전에 띄워야 하는 이유를 담는다. 다음 상황에 호출 — "플레이라이트 써", "브라우저로 재현해", "실제 화면에서 확인해", "MCP 연결 안 된다".
---

# Playwright MCP — 실제 Chrome 화면으로 재현·검증

헤드리스 브라우저로는 로그인 화면 안쪽을 못 본다. 이 스킬은 **사용자가 이미 로그인해 둔
Chrome 탭**에 붙어서 그 화면을 그대로 조작·계측하는 경로를 만든다.
**자격증명은 어떤 형태로도 Claude에게 넘기지 않는다** — 로그인은 사용자가 자기 브라우저에서 직접 한다.

---

## ⚠️ 가장 중요한 것 — 순서

**MCP 서버는 Claude Code 세션을 시작하기 *전에* 떠 있어야 한다.**

Claude Code는 세션 시작 시점에 MCP 서버에 연결을 시도한다. 그때 서버가 없으면
`playwright (ConnectionRefused)` 로 기록되고, **그 세션 내내 도구가 잡히지 않는다.**
세션 도중에 서버를 띄워도 자동으로 다시 붙지 않는다. (확인됨 — ToolSearch 로도 안 잡힘)

세션 도중에 알아챘다면:
- 사용자가 **`/mcp`** 를 실행해 재연결하거나
- 세션을 재시작한다

Claude 는 이걸 스스로 못 한다. 사용자에게 요청할 것.

---

## 절차

### 1. 서버 띄우기 (세션 시작 전)

```bash
export PLAYWRIGHT_MCP_EXTENSION_TOKEN="$(grep -m1 '^PLAYWRIGHT_MCP_EXTENSION_TOKEN=' .env.local | cut -d= -f2- | tr -d '\r\n')"
npx -y @playwright/mcp@latest --port 8931 --extension
```

- 토큰은 `.env.local` 에 있다 (테라포밍 시 루트에서 복사됨). **명령줄에 값을 직접 쓰지 말 것** — 프로세스 목록에 남는다.
- `.env.local` 이 CRLF 면 `set -a; . .env.local` 방식은 깨진다. 위처럼 해당 줄만 뽑아 쓴다.
- 첫 실행은 패키지 내려받느라 1~2분 걸린다. `Listening on http://localhost:8931` 이 뜨면 준비 완료.
- 등록 위치는 `~/.claude.json` 의 `mcpServers.playwright` → `{"type":"http","url":"http://localhost:8931/mcp"}`

확인:
```bash
ss -ltn | grep 8931
```

### 2. Chrome 에서 대상 페이지를 열어 둔다

**사용자가 직접** 자기 Chrome 에서 검증할 페이지를 연다. 로그인이 필요하면 여기서 로그인한다.
`--extension` 모드는 그 브라우저의 세션·쿠키를 그대로 쓰므로, 이 단계가 끝나야 로그인 안쪽을 볼 수 있다.

### 3. Claude Code 세션 시작 → 도구 사용

도구가 잡히는지 확인한 뒤 조작한다. 안 잡히면 위 "순서" 절로 돌아간다.

---

## 무엇을 계측할 것인가

브라우저를 열었으면 스크린샷만 찍고 끝내지 말 것. 버그 재현의 핵심은 **계측**이다.

| 확인할 것 | 방법 |
|---|---|
| 버튼이 실제로 눌리는 위치에 있나 | `el.getBoundingClientRect()` + `document.elementFromPoint(cx, cy)` 로 최상단 요소 확인 (가려짐·화면 밖 판정) |
| 요청이 나갔나 | 네트워크 로그. **서버 로그에 요청이 없으면 프론트에서 멈춘 것** — 서버를 뒤지지 말 것 |
| 이벤트가 어디까지 전파됐나 | 대상·부모에 임시 리스너를 걸고 순서 기록 |
| 페이지가 새로고침됐나 | `performance.navigation` / `navigator.serviceWorker` 상태, `controllerchange` 리스너 |
| 콘솔 에러 | 동적 import 실패(청크 404)는 PWA 캐시 불일치의 전형적 증상 |

---

## 대안 — 같은 출처 iframe 하네스

Chrome 창 자체는 500px 아래로 안 줄어든다. 모바일 폭 검증이 목적이라면
같은 출처의 가벼운 페이지(`/manifest.json` 등)를 열고 iframe 을 주입해 세션을 공유시킨다.

```js
// 같은 출처라 로그인 세션이 공유되어 iframe 안이 로그인 상태로 뜬다
document.body.innerHTML = '<iframe src="/admin-secret" style="width:390px;height:660px">';
```

`contentDocument` 를 조작·측정한다. 저장·삭제는 실행하지 않고 모달은 「취소」로 닫는다.

---

## 함정

- **서버를 세션 도중에 띄우면 그 세션에선 못 쓴다.** (가장 흔한 실패)
- `--extension` 은 사용자 Chrome 에 붙는 모드다. 확장이 없거나 Chrome 이 닫혀 있으면 연결이 안 된다.
- 헤드리스로 새 브라우저를 띄우면 로그인 세션이 없다. 그 경우 자격증명이 필요해지므로 **하지 말 것**.
- 되돌리기 어려운 조작(저장·삭제·전송)은 실행하지 않는다. 확인이 필요하면 사용자에게 묻는다.
