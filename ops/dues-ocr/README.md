# dues-ocr — 회비 캡처 글자 인식 서비스

오라클 서버(`dullg.duckdns.org`)에서 돈다. Netlify 함수 `dues-proof` 가 `https://dullg.duckdns.org/dues-ocr/ocr` 로 그림을 보내면 글자만 돌려준다.

| 항목 | 값 |
|---|---|
| 코드 | `/opt/dues-ocr/dues_ocr.py` (이 폴더의 파일과 같다) |
| 서비스 | `dues-ocr.service` (systemd, 127.0.0.1:3102) |
| 비밀값 | `/etc/dues-ocr/env` 의 `DUES_OCR_SECRET` — Netlify 환경변수 `DUES_OCR_SECRET` 과 같아야 한다 |
| 앞단 | nginx 사이트 `nonotion` 의 `location /dues-ocr/` |
| 의존 | `tesseract-ocr`, `tesseract-ocr-kor`, `python3-pil` (apt) |

- 상태: `systemctl status dues-ocr`, `curl https://dullg.duckdns.org/dues-ocr/health`
- 꺼져 있어도 사이트는 동작한다 — 캡처가 전부 「운영진 확인」으로 넘어갈 뿐이다.
- 비밀값을 바꿀 때: 서버의 `/etc/dues-ocr/env` 를 고치고 `sudo systemctl restart dues-ocr`, Netlify 환경변수를 같은 값으로 바꾼 뒤 재배포.
- 그림·읽힌 글자는 디스크에도 기록에도 남기지 않는다.
