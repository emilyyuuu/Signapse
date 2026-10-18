"""Sends text-only events to the Signapse API. Standard library only.

Posts run on one background thread, in order, so the camera loop never waits on the
network. Only zone ids, sign labels, flags and marker scores are sent; never frames
or landmarks.
"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
import urllib.request

DEMO_ENCOUNTER_ID = "00000000-0000-4000-8000-000000000001"


class ApiClient:
    def __init__(self, api_url: str | None = None, encounter_id: str | None = None, dry_run: bool = False) -> None:
        self.api_url = (api_url or os.environ.get("SIGNAPSE_API_URL") or "http://localhost:8787").rstrip("/")
        self.encounter_id = encounter_id or os.environ.get("SIGNAPSE_ENCOUNTER") or DEMO_ENCOUNTER_ID
        self.dry_run = dry_run
        self._q: queue.Queue[tuple[str, dict]] = queue.Queue()
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self) -> None:
        while True:
            path, body = self._q.get()
            if self.dry_run:
                print(f"[dry-run] POST {path} {json.dumps(body)}")
                continue
            req = urllib.request.Request(
                f"{self.api_url}{path}",
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as res:
                    res.read()
            except Exception as e:  # never crash the camera loop over the network
                print(f"POST {path} failed: {e}", file=sys.stderr)

    def post_point(self, zone: str, confidence: float, gesture: str = "point") -> None:
        body = {"encounterId": self.encounter_id, "zone": zone, "confidence": confidence, "gesture": gesture}
        self._q.put(("/point", body))

    def post_clause(
        self,
        gloss: list[str],
        grammar_flag: str = "statement",
        nmm: dict[str, float | str] | None = None,
        confidence: float | None = None,
    ) -> None:
        """gloss may include POINT-<ZONE> labels; grammar_flag and nmm come from facial_grammar."""
        body: dict = {"encounterId": self.encounter_id, "gloss": gloss, "grammarFlag": grammar_flag}
        if nmm:
            body["nmm"] = nmm
        if confidence is not None:
            body["confidence"] = confidence
        self._q.put(("/clauses", body))
