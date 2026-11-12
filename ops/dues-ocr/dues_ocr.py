#!/usr/bin/env python3
"""회비 캡처 글자 인식 서비스 (오라클 서버, 127.0.0.1 전용 — nginx 가 /dues-ocr/ 로 앞에 선다).

POST /ocr   헤더 X-Ocr-Secret, 본문 = 그림(jpeg/png/webp)  →  {"texts": [...], "ms": 123}
GET  /health                                              →  {"ok": true}

글자만 돌려주고 판정은 하지 않는다 (규칙은 저장소의 netlify/functions/_shared/duesRules.js).
그림은 임시 폴더에만 두고 요청이 끝나면 지운다. 그림·글자를 기록(log)에 남기지 않는다.
한 번에 한 장만 처리한다 — 같은 서버에 마인크래프트가 돈다.
"""
import hmac
import json
import os
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageOps

SECRET = os.environ.get("DUES_OCR_SECRET", "")
PORT = int(os.environ.get("DUES_OCR_PORT", "3102"))
MAX_BYTES = 5_000_000  # 입부 폼은 원본 사진이 온다 (받자마자 긴 변 1600px 로 줄인다)
MAX_SIDE = 1600
TESSERACT_TIMEOUT = 5  # 초. Netlify 함수가 6초에 끊는다
BUSY = threading.Semaphore(1)


def read_texts(data: bytes) -> list:
    with tempfile.TemporaryDirectory(prefix="dues-ocr-") as tmp:
        src = os.path.join(tmp, "in")
        with open(src, "wb") as f:
            f.write(data)
        image = Image.open(src)
        image.load()
        image = ImageOps.exif_transpose(image).convert("L")
        if max(image.size) > MAX_SIDE:
            image.thumbnail((MAX_SIDE, MAX_SIDE))
        normal = os.path.join(tmp, "normal.png")
        inverted = os.path.join(tmp, "inverted.png")
        image.save(normal)
        ImageOps.invert(image).save(inverted)  # 다크 모드 캡처는 뒤집어야 금액이 읽힌다

        env = dict(os.environ, OMP_THREAD_LIMIT="1")
        jobs = [
            subprocess.Popen(
                ["tesseract", path, "-", "-l", "kor+eng", "--psm", psm],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env,
            )
            for path in (normal, inverted) for psm in ("6", "11")
        ]
        deadline = time.monotonic() + TESSERACT_TIMEOUT
        texts = []
        for job in jobs:
            try:
                out, _ = job.communicate(timeout=max(0.1, deadline - time.monotonic()))
                if job.returncode == 0 and out.strip():
                    texts.append(out.decode("utf-8", "replace"))
            except subprocess.TimeoutExpired:
                job.kill()
                job.communicate()
        return texts


class Handler(BaseHTTPRequestHandler):
    server_version = "dues-ocr"

    def log_message(self, *args):  # 접근 기록을 남기지 않는다
        pass

    def reply(self, status: int, body: dict):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self.reply(200, {"ok": True})
        else:
            self.reply(404, {"ok": False})

    def do_POST(self):
        if self.path.rstrip("/") != "/ocr":
            return self.reply(404, {"ok": False})
        if not SECRET or not hmac.compare_digest(self.headers.get("X-Ocr-Secret", ""), SECRET):
            return self.reply(401, {"ok": False})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BYTES:
            return self.reply(413, {"ok": False})
        data = self.rfile.read(length)
        if not BUSY.acquire(timeout=3):
            return self.reply(503, {"ok": False, "error": "busy"})
        started = time.monotonic()
        try:
            texts = read_texts(data)
        except Exception:
            return self.reply(400, {"ok": False, "error": "bad_image"})
        finally:
            BUSY.release()
        self.reply(200, {"ok": True, "texts": texts, "ms": int((time.monotonic() - started) * 1000)})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
