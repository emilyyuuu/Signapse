"""Local camera preview for the patient screen.

Serves the annotated camera frames as an MJPEG stream on 127.0.0.1 only, so the web page
can show the camera without a separate window. Video never leaves this computer: the
stream is bound to the loopback address, and only zone ids go to the Signapse API.

  GET /video   multipart MJPEG stream (use as an <img> source)
  GET /status  {"running": true, "signs": {...}}  (camera on/off and the signing session)
  POST /sign   {"action": "start" | "done" | "cancel"}  (the patient's signing buttons)
  POST /record {"action": "start", "sign": "pain"} | {"action": "cancel"}  (staff: new examples)
  POST /rebuild  (staff: retrain the recorded-sign model from the examples)

POST is accepted only from the Signapse web page's own origin (CORS_ORIGIN), so another
website open in the browser can't start or send signing.
"""

from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

class _QuietServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        # A tab closing mid-request is normal; do not print a traceback for it.
        pass


def _allowed_origins() -> set[str]:
    raw = os.environ.get("CORS_ORIGIN") or ""
    found = {o.strip().rstrip("/") for o in raw.split(",") if o.strip()}
    return found | {"http://localhost:5173", "http://127.0.0.1:5173"}


BOUNDARY = "frame"
MAX_WIDTH = 640  # the page shows it small; keeps encoding cheap


class Preview:
    def __init__(self, port: int, signs=None, recorder=None) -> None:
        self.port = port
        self.signs = signs  # SignSession, or None when there is no sign recognition
        self.recorder = recorder  # Recorder for new sign examples, or None
        self.tracked_at = 0.0  # time.monotonic() of the last tracked frame, set by the camera loop
        self._cond = threading.Condition()
        self._jpeg: bytes | None = None
        self._seq = 0
        self.viewers = 0
        self._server: _QuietServer | None = None

    def start(self) -> bool:
        """Start serving in a background thread. Returns False if the port is taken."""
        preview = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:  # keep the terminal quiet
                pass

            def _headers(self, status: int, content_type: str) -> None:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store")
                # The page is on another origin (localhost:5173 or the hosted site).
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
                self.send_header("Access-Control-Allow-Private-Network", "true")

            def _json(self, status: int, data: dict) -> None:
                body = json.dumps(data).encode()
                self._headers(status, "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self) -> None:
                self._headers(204, "text/plain")
                self.send_header("Access-Control-Allow-Methods", "GET, POST")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.end_headers()

            def do_POST(self) -> None:
                path = self.path.split("?")[0]
                if path not in ("/sign", "/record", "/rebuild"):
                    return self._json(404, {"error": "not found"})
                origin = (self.headers.get("Origin") or "").rstrip("/")
                if origin and origin not in _allowed_origins():
                    return self._json(403, {"error": "This page may not control the camera."})
                try:
                    length = min(int(self.headers.get("Content-Length") or 0), 1024)
                    body = json.loads(self.rfile.read(length) or b"{}")
                    action = body.get("action")
                except (ValueError, AttributeError):
                    body, action = {}, None
                if path == "/sign":
                    if preview.signs is None:
                        return self._json(503, {"error": "Sign recognition is not running."})
                    handlers = {"start": preview.signs.start, "done": preview.signs.finish, "cancel": preview.signs.cancel}
                    if action not in handlers:
                        return self._json(400, {"error": "action must be start, done or cancel"})
                    result = handlers[action]()
                else:
                    rec = preview.recorder
                    if rec is None:
                        return self._json(503, {"error": "Recording is not available."})
                    if path == "/rebuild":
                        result = rec.rebuild()
                    elif action == "start":
                        if preview.signs is not None and preview.signs.is_open:
                            return self._json(409, {"ok": False, "error": "The patient is signing right now."})
                        result = rec.start(str(body.get("sign") or ""))
                    elif action == "cancel":
                        result = rec.cancel()
                    else:
                        return self._json(400, {"error": "action must be start or cancel"})
                self._json(200 if result.get("ok") else 409, result)

            def do_GET(self) -> None:
                path = self.path.split("?")[0]
                if path == "/status":
                    status: dict = {"running": True}
                    if preview.tracked_at:
                        status["trackedMsAgo"] = round((time.monotonic() - preview.tracked_at) * 1000)
                    if preview.signs is not None:
                        status["signs"] = preview.signs.status()
                    if preview.recorder is not None:
                        status["record"] = preview.recorder.status()
                    self._json(200, status)
                elif path == "/video":
                    self._headers(200, f"multipart/x-mixed-replace; boundary={BOUNDARY}")
                    self.end_headers()
                    self._stream()
                else:
                    self._headers(404, "text/plain")
                    self.end_headers()

            def _stream(self) -> None:
                seq = 0
                preview._viewer(+1)
                try:
                    while True:
                        jpeg, seq = preview._wait(seq)
                        if jpeg is None:
                            continue
                        self.wfile.write(
                            f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpeg)}\r\n\r\n".encode()
                            + jpeg
                            + b"\r\n"
                        )
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    pass
                finally:
                    preview._viewer(-1)

        try:
            self._server = _QuietServer(("127.0.0.1", self.port), Handler)
        except OSError as e:
            print(f"Camera preview not started (port {self.port}): {e}")
            return False
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        print(f"Camera preview on http://127.0.0.1:{self.port}/video (this computer only)")
        return True

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()

    def _viewer(self, delta: int) -> None:
        with self._cond:
            self.viewers += delta

    def _wait(self, last_seq: int) -> tuple[bytes | None, int]:
        with self._cond:
            self._cond.wait_for(lambda: self._seq != last_seq, timeout=5)
            return self._jpeg, self._seq

    def update(self, img) -> None:
        """Publish a frame. Skipped when nobody is watching."""
        if self.viewers <= 0:
            return
        h, w = img.shape[:2]
        if w > MAX_WIDTH:
            img = cv2.resize(img, (MAX_WIDTH, int(h * MAX_WIDTH / w)))
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 72])
        if not ok:
            return
        with self._cond:
            self._jpeg = buf.tobytes()
            self._seq += 1
            self._cond.notify_all()
