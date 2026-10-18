# Signapse

**Real-time sign-to-clinical translation for Deaf and hard-of-hearing patients.**

Signapse translates between a Deaf patient and medical staff in real time. In sign language the face is part of the grammar: raised brows turn a statement into a yes/no question, a head shake turns it into a denial. Signapse reads eyebrows, squint and head movement along with the hands, so a question stays a question and a denial stays a denial.

Signs become a clean clinical sentence that is spoken to the doctor and filed as chart data. The doctor's reply goes back to the patient as plain-language text and icons. Video never leaves the device. The whole conversation is logged in Tiger Data (Postgres + TimescaleDB) for review at charting time.

This is a hackathon project (about 36 hours). The full plan, a clickable prototype, the schema, the task list and the demo script live in the project artifact: https://claude.ai/artifact/4wQskwmT2C7UvuXct6xFtE

## How it works

1. **Sign recognition (on device).** MediaPipe `HandLandmarker` and `FaceLandmarker` run in a local Python process on the patient laptop (`apps/facial_grammar`). Hand landmarks are normalized (subtract the wrist position, divide by hand size) and split into segments by hand speed. Each segment is matched against recorded templates with DTW + k-NN. The vocabulary is about 30 isolated clinical ASL signs, about 20 takes each, stored as landmark JSON only, never video.
2. **Facial grammar engine (on device).** This is the core feature. A neutral-face calibration stores a baseline for each patient. Over each clause window, `browInnerUp`/`browOuterUp`/`browDown`/`eyeSquint` blendshapes and head yaw/pitch are mapped to one of four flags: `statement`, `question` (brows raised for more than ~300 ms), `negation` (2 or more yaw reversals) or `intensified` (furrow or squint). The rules are plain Python (`apps/facial_grammar/`), not a model.
3. **Clinical sentence processor.** A phrase table keyed by complaint fills a sentence template for each flag. An optional Claude Haiku rewrite works on redacted text only and falls back to the template after 1 s. Output is spoken with `speechSynthesis` and saved as structured fields. Any meaning that depends on a facial marker is flagged for the clinician to confirm.
4. **Clinician reply.** Typed replies (in-browser Whisper dictation is a stretch goal) are rewritten in plain language and matched to icons. A reply ending in `?` shows large YES/NO buttons, and the patient's tap is logged.
5. **Body map.** An SVG front/back view with 21 zones and severity 0–10. Each change becomes a `pain_readings` row.
6. **Chart review (Tiger Data).** Two hypertables (`utterances`, `pain_readings`) partitioned by time and segmented by encounter, plus a continuous aggregate for the pain trend. The review screen replays an encounter, lets the clinician verify flagged lines and drafts a chart note with unverified lines labelled.

## Stack

**Vision** (sign recognition + facial grammar) is Python with MediaPipe and OpenCV, in one camera loop on the patient laptop. Only text events leave that process.

**Web:** React + Vite + TypeScript (or Next.js), with routes for **patient**, **clinician** and **review**. A Node API (Hono or Fastify, `pg`, one WebSocket room per encounter) validates and relays events. Tiger Cloud is set up with the Tiger CLI or Tiger MCP. The frontend is deployed on Vercel/Netlify and the API on Render/Fly (HTTPS is required for the camera).

## Repo layout

```
apps/facial_grammar/  Python package `facial_grammar`, runs on the patient laptop; video never leaves it
  capture.py          webcam + MediaPipe Face Landmarker loop
  features.py         blendshapes + head pose -> Frame
  calibration.py      3 s neutral-face baseline per patient
  clause.py, rules.py clause window -> statement / question / negation / intensified
  datatypes.py        Frame, Baseline, Thresholds (tune here), GrammarResult
  clips.py, lab.py    live lab: calibrate, mark clauses, label and save clips
  scripts/            fetch_models.sh downloads models/ (gitignored)
  tests/              pytest, incl. accuracy on data/grammar/clips
apps/web/             React + Vite frontend
  src/routes/         patient, clinician, review screens
  src/language/       phrase table, sentence templates, plain-language replies
  src/components/     shared UI (bodymap/, ...)
  src/wizard/         wizard-mode operator panel
  src/lib/            event queue, API/WebSocket client
apps/api/             Node API
  src/routes/         /events, encounters, verify, chart note
  src/ws/             one WebSocket room per encounter
  src/db/             pg client and queries
packages/shared/      shared TypeScript contracts (types.ts)
db/schema.sql         Tiger Data schema; db/seed/ for sample encounters
data/signs/           recorded sign templates (landmark JSON only, never video)
data/grammar/clips/   labelled facial grammar clips (feature JSON only)
tools/recorder/       recorder tool for labelled landmark takes
```

## Running facial grammar

```
cd apps/facial_grammar && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
scripts/fetch_models.sh
.venv/bin/pytest -s                      # unit tests + per-flag accuracy on data/grammar/clips
.venv/bin/python -m facial_grammar.lab   # c calibrate, space clause, 1-4 label, s save, q quit
```

Grammar thresholds are in `apps/facial_grammar/datatypes.py`. Tune them against recorded clips.

## Shared contracts (agree these first)

- **Sign event:** label, confidence, start/end time. Wizard mode emits the same shape.
- **Clause:** the signs in one clause plus its face/head frames, which go in to produce a grammar flag.
- **Utterance event:** speaker, kind, gloss, markers, flag, sentence, confidence. This is text only, and it is the only thing that leaves the device.

## Connecting sign recognition and facial grammar

When the patient pauses after a clause, the vision process POSTs the signs and the facial-grammar result to the API's `/clauses` endpoint. The server turns it into a clinical sentence (Gemini, with a rule-based fallback), saves it and pushes it to the clinician screen.

From Python (`apps/facial_grammar`), standard library only:

```python
import json, urllib.request

def send_clause(encounter_id, gloss, result, confidence=None, api="http://localhost:8787"):
    """gloss: sign labels, e.g. ["PAIN", "CHEST"]; result: GrammarResult from rules.py."""
    body = {"encounterId": encounter_id, "gloss": gloss,
            "grammarFlag": str(result.flag), "nmm": result.to_nmm()}
    if confidence is not None:
        body["confidence"] = confidence  # 0..1, lowest sign confidence in the clause
    req = urllib.request.Request(f"{api}/clauses", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res)  # {utterance, priority, needsConfirm, source}
```

Rules the API enforces (anything else gets a 400):
- `gloss`: 1–20 uppercase sign names (`PAIN`, `CHEST`), no free text.
- `grammarFlag`: `statement`, `question`, `negation` or `intensified`.
- `nmm`: up to 20 keys, each a number or short text. `GrammarResult.to_nmm()` fits as is.
- No other fields. Never send frames or landmarks.

To find the visit to send to, `GET /encounters?active=true` lists open visits, newest first (the clinician starts one with **New visit**). Sends to an ended visit get a 409. The demo encounter id is `00000000-0000-4000-8000-000000000001`. The API rate-limits each client (30 Gemini-backed calls and 120 writes per minute by default), so send one clause per pause, not per frame. From browser code, `sendClause` in `apps/web/src/lib/api.ts` does the same call.

To test without a camera, call the endpoint directly:

```cmd
curl -X POST http://localhost:8787/clauses -H "Content-Type: application/json" -d "{\"encounterId\":\"00000000-0000-4000-8000-000000000001\",\"gloss\":[\"PAIN\",\"CHEST\"],\"grammarFlag\":\"statement\",\"confidence\":0.9}"
```

For body-map pointing, call `report(zone, severity, "pointing")` from `usePainMap`, and pass `highlighted={zoneId}` to `<BodyMap>` while the fingertip hovers. Zone ids and shapes are in `BODY_VIEWS` in `packages/shared/src/bodyZones.ts`.

## Non-negotiables

- **Privacy:** camera frames and landmarks are processed in the local vision process and discarded. The API rejects anything that isn't text or numbers. Patients are tokens, not names. The UI shows a live "video frames sent: 0" counter. Chrome's `SpeechRecognition` sends audio to the cloud, so don't use it outside a clearly labelled stand-in.
- **Safety:** a wrong meaning is a clinical risk, so lines that depend on a marker need clinician confirmation before charting. Signapse does not replace qualified interpreters and is not HIPAA/PHIPA compliant.
- **Demo resilience:** wizard mode (an operator triggers signs through the same pipeline) must work end to end before hour 8. Event writes are queued and must never block the UI.

## Out of scope

Continuous or open-vocabulary sign recognition, replacing interpreters, and production compliance.
