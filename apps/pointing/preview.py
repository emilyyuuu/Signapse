"""Local camera preview for the patient screen.

Serves the annotated camera frames as an MJPEG stream on 127.0.0.1 only, so the web page
can show the camera without a separate window. Video never leaves this computer: the
stream is bound to the loopback address, and only zone ids go to the Signapse API.

  GET /video   multipart MJPEG stream (use as an <img> source)
  GET /status  {"running": true}  (the page polls this to show camera on/off)
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

class _QuietServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        # A tab closing mid-request is normal; do not print a traceback for it.
        pass


BOUNDARY = "frame"
MAX_WIDTH = 640  # the page shows it small; keeps encoding cheap


class Preview:
    def __init__(self, port: int) -> None:
        self.port = port
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

            def do_OPTIONS(self) -> None:
                self._headers(204, "text/plain")
                self.end_headers()

            def do_GET(self) -> None:
                path = self.path.split("?")[0]
                if path == "/status":
                    body = json.dumps({"running": True}).encode()
                    self._headers(200, "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
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
