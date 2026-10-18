"""Camera helper: lets the hosted Signapse page start the pointing camera on this computer.

When the API runs on a server (Render), it can't start a program on the patient's laptop.
This small helper runs on the laptop instead, starts at login, and waits. The patient page
asks it to start ``pointing.lab`` for a visit and to stop it again. Standard library only.

  python -m pointing.launcher install --api https://signapse.onrender.com \\
      --origin https://signapse.noahsun0418.workers.dev,https://signapse.health
  python -m pointing.launcher uninstall
  python -m pointing.launcher run ...   (what the login entry runs; same --api / --origin)

Served on 127.0.0.1:8764 only (same shapes as the API's /camera routes):
  GET  /camera/status   {available, running, encounterId?, exited?, log}
  POST /camera/start    {"encounterId": "<uuid>"}
  POST /camera/stop

Locked down: loopback only; any request from a web page must come from one of --origin
(so another website can't switch the camera on); the only input is a visit id, checked as
a UUID; one fixed command. The camera turns itself off when no Signapse page has checked
on it for a minute (tab closed), so it never stays on unnoticed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8764
PREVIEW_PORT = 8765  # pointing.lab's local preview (preview.py)
IDLE_STOP_S = 60  # no page has polled the preview for this long: stop the camera
START_GRACE_S = 45  # models take a while to load; don't judge idleness before this
DEV_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
IS_WINDOWS = sys.platform == "win32"
LOG_FILE = Path(__file__).resolve().parent / "launcher.log"  # gitignored (*.log)
# MediaPipe prints harmless warnings; keep real lines only.
NOISE = re.compile(r"inference_feedback_manager|landmark_projection_calculator|InitGoogle|XNNPACK")


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass
    if sys.stdout:  # None under pythonw
        print(line, flush=True)


def _child_python() -> str:
    # Under pythonw (Windows login entry) the camera program still wants a console-less
    # python.exe so its output can be read.
    exe = Path(sys.executable)
    if IS_WINDOWS and exe.name.lower() == "pythonw.exe":
        return str(exe.with_name("python.exe"))
    return str(exe)


class Camera:
    def __init__(self, api_url: str, origins: set[str]) -> None:
        self.api_url = api_url
        self.origins = origins
        self.lock = threading.Lock()
        self.child: subprocess.Popen | None = None
        self.encounter_id: str | None = None
        self.started_at = 0.0
        self.last_exit: int | None = None
        self.exited = False
        self.log_tail: deque[str] = deque(maxlen=12)
        threading.Thread(target=self._idle_watch, daemon=True).start()

    def running(self) -> bool:
        return self.child is not None and self.child.poll() is None

    def status(self) -> dict:
        with self.lock:
            out: dict = {"available": True, "running": self.running(), "log": list(self.log_tail)[-4:]}
            if self.running():
                out["encounterId"] = self.encounter_id
            elif self.exited:
                out["exited"] = {"code": self.last_exit}
            return out

    def start(self, encounter_id: str) -> tuple[int, dict]:
        with self.lock:
            if self.running() and self.encounter_id == encounter_id:
                return 200, {"running": True, "encounterId": encounter_id}
            self._stop()
            self.log_tail.clear()
            self.exited = False
            env = {
                **os.environ,
                "SIGNAPSE_ENCOUNTER": encounter_id,
                "SIGNAPSE_API_URL": self.api_url,
                # preview.py only takes signing buttons from these pages.
                "CORS_ORIGIN": ",".join(sorted(self.origins)),
                "PYTHONUNBUFFERED": "1",
                "PYTHONIOENCODING": "utf-8",
            }
            try:
                child = subprocess.Popen(
                    [_child_python(), "-m", "pointing.lab", "--no-window", "--preview-port", str(PREVIEW_PORT)],
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0,
                )
            except OSError as e:
                self.log_tail.append(f"Could not start: {e}")
                return 500, {"error": f"Could not start the camera program: {e}"}
            self.child, self.encounter_id, self.started_at = child, encounter_id, time.monotonic()
            threading.Thread(target=self._read_output, args=(child,), daemon=True).start()
            log(f"Camera started for visit {encounter_id}")
            return 201, {"running": True, "encounterId": encounter_id}

    def stop(self) -> None:
        with self.lock:
            self._stop()

    def _stop(self) -> None:
        child, self.child = self.child, None
        if child is None or child.poll() is not None:
            return
        if IS_WINDOWS:
            # Kill the whole tree (python may have helper processes).
            subprocess.run(["taskkill", "/pid", str(child.pid), "/t", "/f"], capture_output=True,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
        log("Camera stopped")

    def _read_output(self, child: subprocess.Popen) -> None:
        assert child.stdout is not None
        for raw in child.stdout:
            line = raw.decode("utf-8", "replace").strip()
            if line and not NOISE.search(line):
                self.log_tail.append(line[:300])
        code = child.wait()
        with self.lock:
            if self.child is child:  # exited by itself, not stopped
                self.child, self.exited, self.last_exit = None, True, code
                log(f"Camera program exited ({code})")

    def _idle_watch(self) -> None:
        while True:
            time.sleep(5)
            if not self.running() or time.monotonic() - self.started_at < START_GRACE_S:
                continue
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PREVIEW_PORT}/status", timeout=2) as res:
                    ago = json.load(res).get("polledMsAgo")
            except Exception:
                continue  # still loading, or busy; check again
            if ago is None or ago > IDLE_STOP_S * 1000:
                log("No Signapse page open for a minute; turning the camera off")
                self.stop()


def serve(camera: Camera) -> None:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

        def _origin_ok(self) -> bool:
            # Requests from a web page carry Origin; anything else is a program on this computer.
            origin = (self.headers.get("Origin") or "").rstrip("/")
            return not origin or origin in camera.origins or origin in DEV_ORIGINS

        def _json(self, status: int, data: dict) -> None:
            body = json.dumps(data).encode()
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin and self._origin_ok():
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            self.send_response(204 if self._origin_ok() else 403)
            if self._origin_ok() and self.headers.get("Origin"):
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()

        def do_GET(self) -> None:
            if not self._origin_ok():
                return self._json(403, {"error": "This page may not control the camera."})
            if self.path.split("?")[0] == "/camera/status":
                return self._json(200, camera.status())
            self._json(404, {"error": "not found"})

        def do_POST(self) -> None:
            if not self._origin_ok():
                return self._json(403, {"error": "This page may not control the camera."})
            path = self.path.split("?")[0]
            if path == "/camera/stop":
                camera.stop()
                return self._json(200, {"running": False})
            if path != "/camera/start":
                return self._json(404, {"error": "not found"})
            try:
                length = min(int(self.headers.get("Content-Length") or 0), 1024)
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                body = None
            if not isinstance(body, dict) or set(body) != {"encounterId"} or not UUID_RE.match(str(body["encounterId"])):
                return self._json(400, {"error": "bad request"})
            status, data = camera.start(body["encounterId"].lower())
            self._json(status, data)

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def handle_error(self, request, client_address) -> None:
            pass

    server = Server(("127.0.0.1", PORT), Handler)
    log(f"Camera helper on http://127.0.0.1:{PORT} (API {camera.api_url}; pages {', '.join(sorted(camera.origins))})")
    try:
        server.serve_forever()
    finally:
        camera.stop()


# --- Start at login ---------------------------------------------------------------------

LABEL = "health.signapse.camera"


def _run_args(api: str, origins: str) -> list[str]:
    exe = Path(sys.executable)
    if IS_WINDOWS and exe.name.lower() == "python.exe" and exe.with_name("pythonw.exe").exists():
        exe = exe.with_name("pythonw.exe")  # no console window at login
    return [str(exe), "-m", "pointing.launcher", "run", "--api", api, "--origin", origins]


def install(api: str, origins: str) -> None:
    args = _run_args(api, origins)
    if IS_WINDOWS:
        import winreg

        cmd = subprocess.list2cmdline(args)
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0,
                            winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, "SignapseCamera", 0, winreg.REG_SZ, cmd)
        subprocess.Popen(args, creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW)
        where = r"HKCU\...\Run\SignapseCamera"
    elif sys.platform == "darwin":
        import plistlib

        plist = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
        plist.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
        plist.write_bytes(plistlib.dumps({"Label": LABEL, "ProgramArguments": args, "RunAtLoad": True, "KeepAlive": True}))
        subprocess.run(["launchctl", "load", str(plist)], check=True)
        where = str(plist)
    else:
        unit = Path.home() / ".config" / "systemd" / "user" / "signapse-camera.service"
        unit.parent.mkdir(parents=True, exist_ok=True)
        unit.write_text(
            "[Unit]\nDescription=Signapse camera helper\n\n"
            f"[Service]\nExecStart={subprocess.list2cmdline(args)}\nRestart=on-failure\n\n"
            "[Install]\nWantedBy=default.target\n"
        )
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "--user", "enable", "--now", "signapse-camera.service"], check=True)
        where = str(unit)
    print(f"Installed: the camera helper starts at login ({where}) and is running now.")


def uninstall() -> None:
    if IS_WINDOWS:
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0,
                                winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, "SignapseCamera")
        except FileNotFoundError:
            pass
        print("Removed from login. A helper that is running now stops at the next sign-out.")
    elif sys.platform == "darwin":
        plist = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
        subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
        plist.unlink(missing_ok=True)
        print("Removed.")
    else:
        subprocess.run(["systemctl", "--user", "disable", "--now", "signapse-camera.service"], capture_output=True)
        (Path.home() / ".config" / "systemd" / "user" / "signapse-camera.service").unlink(missing_ok=True)
        print("Removed.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("run", "install"):
        p = sub.add_parser(name)
        p.add_argument("--api", required=True, help="Signapse API, e.g. https://signapse.onrender.com")
        p.add_argument("--origin", required=True, help="the Signapse web page(s), comma separated")
    sub.add_parser("uninstall")
    args = parser.parse_args()
    if args.cmd == "uninstall":
        return uninstall()
    api = args.api.rstrip("/")
    origins = {o.strip().rstrip("/") for o in args.origin.split(",") if o.strip()}
    if args.cmd == "install":
        return install(api, ",".join(sorted(origins)))
    serve(Camera(api, origins))


if __name__ == "__main__":
    main()
