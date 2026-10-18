# Signapse

**Real-time sign-to-clinical translation for Deaf and hard-of-hearing patients.**

Signapse lets a Deaf patient sign to a camera and have a doctor hear a clear clinical sentence. It also reads the patient's face, because in ASL the face is part of the grammar. The doctor's reply comes back as plain text with icons. Video never leaves the patient's laptop.

## Contents

- [Inspiration](#inspiration)
- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [How we built it](#how-we-built-it)
- [Quick start](#quick-start)
- [Challenges we ran into](#challenges-we-ran-into)
- [Accomplishments we're proud of](#accomplishments-were-proud-of)
- [What we learned](#what-we-learned)
- [What's next](#whats-next)
- [Technical deep dive](#technical-deep-dive)
- [Privacy and safety](#privacy-and-safety)
- [Team](#team)

## Inspiration

In a clinic, Deaf patients often wait for an interpreter, write notes back and forth, or rely on a family member. Each of these is slow and can be wrong. In an emergency, it's dangerous.

Most sign-to-text tools only look at the hands, and that misses a lot. In ASL, raised eyebrows turn "you have pain" into "do you have pain?", and a head shake turns "chest pain" into "no chest pain". A translator that ignores the face can report the opposite of what the patient meant. Signapse treats the face as part of the sentence.

## What it does

**For the patient** (laptop with a webcam):
- **Sign how you feel.** The camera reads clinical signs (pain, headache, fever, nausea, chest, stomach, jaw, face, heart attack) and shows each word as it is recognised. Large buttons are there as a fallback.
- **Facial grammar.** Raised brows mark a question, a head shake marks a negation, and a furrow or squint marks emphasis. These change the meaning of the sentence and the tone of the spoken voice.
- **Point to where it hurts.** The patient can point at or touch their own body, and the camera maps it to a body-map zone (left/right chest, four abdominal quadrants, jaw, etc.). They can also just tap the body map.
- **Check before sending.** The patient sees "You said: I have left chest pain. It is 7 out of 10." and chooses **Send to the doctor** or **Start again**. Urgent messages send themselves after 10 s if the patient doesn't answer.

**For the clinician:**
- A clinical sentence ("The patient reports pain at the left side of the chest and rates the pain 7 out of 10."), spoken aloud in a tone that follows the patient's face, with a chime when it's urgent.
- A live pain map and pain trend.
- Any meaning that depends on a facial cue is marked **Confirm meaning** before it can be charted.
- Typed replies go back to the patient in plain language. A reply ending in `?` gives the patient big YES/NO buttons.

**After the visit:**
- **Review** replays the encounter from Tiger Data, lets the clinician verify flagged lines, and drafts a chart note that labels unverified lines.

**Remote visits:**
- **Call mode** is an end-to-end encrypted WebRTC video call. The patient's signs appear as captions on the doctor's screen, and the doctor's speech is captioned live for the patient.

**Teaching new signs:**
- **/record** lets staff record a few examples of a new sign and rebuild the model from the browser, without writing any code.

## How it works

```
 Patient laptop (on device)                                 Cloud
┌─────────────────────────────────────────┐   text only   ┌──────────────────────┐
│ Webcam → MediaPipe hands / face / pose  │──────────────▶│ Node API (Hono + WS) │
│   ├─ sign recognition (DTW + k-NN)      │  sign labels, │  ├─ Gemini rewrite   │
│   ├─ facial grammar rules               │  marker       │  │   (template       │
│   └─ pointing → body-map zone           │  scores,      │  │    fallback)      │
│                                         │  zone ids     │  ├─ patient drafts   │
│ Patient web page (React)  ◀─────────────┼───────────────│  └─ Tiger Data       │
└─────────────────────────────────────────┘   WebSocket   │     (Postgres +      │
                                                          │      TimescaleDB)    │
 Clinician web page (React) ◀─────────────────────────────┤                      │
                                                          └──────────────────────┘
```

1. **Sign recognition (on device).** MediaPipe `HandLandmarker` and `FaceLandmarker` run in one local Python process on the patient laptop (`apps/pointing`, using the recorded-sign model from `apps/recognition-python`). Hand landmarks are normalized (subtract the wrist position, divide by hand size), and each sign (hands up, sign, hands down) is matched against recorded templates with DTW + k-NN. The vocabulary is a small set of isolated clinical ASL signs (chest, face, fever, headache, heart attack, jaw, nausea, pain, stomach). The model stores hand points only, never video. See [The patient's path](#the-patients-path-sign-model--face--gemini).
2. **Facial grammar engine (on device).** This is the core feature. A neutral-face baseline is stored for each patient. Over each clause window, `browInnerUp`/`browOuterUp`/`browDown`/`eyeSquint` blendshapes and head yaw/pitch are mapped to one of four flags: `statement`, `question` (brows raised for more than ~300 ms), `negation` (2 or more yaw reversals) or `intensified` (furrow or squint). The rules are plain Python (`apps/facial_grammar/`), not a model, so they can be explained and tuned.
3. **Clinical sentence processor.** A phrase table keyed by complaint fills a sentence template for each flag (`packages/shared/src/language.ts`). An optional Gemini rewrite (`apps/api/src/language/`) gets sign labels and marker scores only, never names. If Gemini is slow or drops a symptom, place or rating, the template is used instead. The sentence is spoken with `speechSynthesis` and saved as structured fields. The voice's tone follows the face (`packages/shared/src/tone.ts`): a question (raised eyebrows) has a higher pitch, a negation (head shake) is lower and slower, emphasis (furrowed brows) is slower and louder, and strong cues push further. Only the sound changes, never the words. The "please confirm" reminder is always read in a plain voice. Only on-device voices are used.
4. **Clinician reply.** Typed replies are rewritten in plain language and matched to icons. In call mode, the doctor's speech is captioned live. A reply ending in `?` shows large YES/NO buttons, and the patient's tap is logged.
5. **Body map.** SVG front, back and face views with severity 0–10. Zones are specific where it matters clinically: left/right chest, four abdominal quadrants plus the navel, left/right upper and lower back, and the eyes, nose, mouth, cheeks, jaw, ears and forehead. Each change becomes a `pain_readings` row. The patient can also **point at or touch their own body** (`apps/pointing`). An index-finger point counts after 0.2 s. A touch with any hand shape counts after 0.7 s, but only when the hand is at body depth, not out in front in signing space. A touch only highlights the zone (dashed) and opens the pain picker; it is recorded once the patient rates it. Inside a clause, a point becomes a `POINT-<ZONE>` sign, so `PAIN POINT-CHEST` reads as "The patient reports chest pain."
6. **Chart review (Tiger Data).** Hypertables (`utterances`, `pain_readings`, `patient_actions`) are partitioned by time and segmented by encounter, plus a continuous aggregate for the pain trend. The review screen replays an encounter, lets the clinician verify flagged lines, and drafts a chart note with unverified lines labelled.

## How we built it

| Layer | Tech |
| --- | --- |
| Vision (on device) | Python, MediaPipe (Hand, Face and Pose Landmarker), OpenCV, NumPy |
| Sign recognition | DTW + k-NN over normalized hand landmarks, trained on our own recordings |
| Facial grammar | Rule engine over MediaPipe blendshapes and head pose |
| Frontend | React 18, Vite, TypeScript, Web Speech API (`speechSynthesis`, `SpeechRecognition`), WebRTC |
| API | Node, Hono, WebSockets (`ws`), Zod validation, `pg` |
| Language | Google Gemini, with a rule-based template fallback |
| Database | Tiger Data / Tiger Cloud (Postgres + TimescaleDB hypertables and continuous aggregates) |
| Deploy | Cloudflare (Wrangler, static assets from `apps/web/dist`) for the frontend, Render for the API |

Vision (sign recognition, facial grammar and pointing) runs in one camera loop on the patient laptop, and only text events leave that process. The web app has routes for **patient**, **clinician**, **review**, **call**, **wizard** and **record**. The Node API validates and relays events, with one WebSocket room per encounter. HTTPS is required for the camera outside localhost.

## Quick start

**Requirements:** Node 20+, Python 3.10–3.12, a webcam. Chrome or Edge is recommended (speech and camera APIs).

```bash
# 1. Install JS dependencies (npm workspaces)
npm install

# 2. Configure
cp .env.example .env     # DATABASE_URL and GEMINI_API_KEY are optional, see below

# 3. (Optional) set up Tiger Data: applies db/schema.sql and the seed data
npm run db:setup -w @signapse/api

# 4. Run the API and the web app (two terminals)
npm run dev:api          # http://localhost:8787
npm run dev:web          # http://localhost:5173

# 5. Run the camera program on the patient laptop
cd apps/pointing && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
scripts/fetch_models.sh
.venv/bin/python -m pointing.lab --no-window
```

- With no `DATABASE_URL`, the API uses an in-memory store, so the demo works offline.
- With no `GEMINI_API_KEY`, clinical sentences come from the rule-based templates.
- Set `LOCAL_CAMERA=true` in `.env` and the patient page starts the camera program by itself during local development.
- **No camera?** Open `/wizard` to act as the patient through the same pipeline (see [Wizard mode](#wizard-mode)).

**Try the demo:** open `/` and start a visit. Put the **patient** screen on the laptop with the webcam and the **clinician** screen on a second screen or device. Sign `PAIN`, point at your chest, rate it 7, and press **Send to the doctor**. Then sign it again with raised eyebrows and see the question on the clinician side.

**Tests:**

```bash
cd apps/facial_grammar && .venv/bin/pytest -s   # rules + per-flag accuracy on recorded clips
cd apps/pointing && .venv/bin/pytest            # pointing, head gestures, signs, recorder
npm test -w @signapse/shared                    # sentence templates, signs, voice tone
```

## Challenges we ran into

- **Telling signs apart from pointing.** Many ASL signs touch the body (MY, PLEASE, SORRY, ME). We added several filters to `tracker.py`: the hand has to arrive and then hold still, touches need 0.7 s, points take priority over touches, and a point at mid-chest needs a longer hold unless PAIN was just signed.
- **Little training data.** There are few public datasets of clinical ASL signs. We trained a CNN on a public dataset (`medical_asl_cnn_v1`, `train_neural.py`), but the live system uses DTW + k-NN over our own recordings. It works with a handful of examples per sign, and new signs can be taught from the browser.
- **Faces differ from person to person.** A fixed eyebrow threshold flags some people's resting face as a question. The camera now learns each patient's resting face while they aren't signing, so there's no calibration step.
- **LLMs that drop facts.** Gemini sometimes left out the location or rating. Its output is checked against the signs, and the template is used if anything is missing, so a symptom is never lost.
- **Privacy in call mode.** Showing the patient's video to the doctor without sending it through our server meant using peer-to-peer WebRTC, an admit step, and safety codes built from the DTLS fingerprints.

## Accomplishments we're proud of

- Facial grammar that changes the meaning, not just a label: a question stays a question and a denial stays a denial, all the way to the chart.
- No video frames leave the device: only sign labels, marker scores and zone ids do, and the API rejects anything else.
- The patient confirms what they said before it reaches the doctor, and anything that depends on a facial cue needs clinician confirmation before charting.
- Staff can teach the system a new sign in a few minutes from the browser.
- A full loop in one weekend: sign → sentence → speech → chart review, plus encrypted remote calls.

## What we learned

- The face carries a lot of ASL grammar, and simple, explainable rules on top of MediaPipe blendshapes go a long way.
- In a clinical setting, a deterministic fallback and human confirmation matter more than a more fluent sentence.
- TimescaleDB hypertables and continuous aggregates suit a conversation log: time-ordered, grouped by encounter, with trends for free.

## What's next

- A larger vocabulary and continuous (not isolated) sign recognition, built with Deaf signers and interpreters.
- Other sign languages (LSQ, BSL).
- Speech recognition on the device for the clinician, so no audio leaves the room.
- Integration with EHR systems (FHIR) for chart notes.
- A clinical pilot and work toward HIPAA/PHIPA compliance.

---

# Technical deep dive

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
apps/pointing/        Python package `pointing`: point at your own body -> body-map zone id
  capture.py          webcam + MediaPipe Pose + Hand Landmarker loop
  features.py         pose + hand landmarks -> BodyFrame
  handshape.py        point vs touch, which arm, contact point, depth from apparent hand size
  zones.py            contact point -> zone id (ids from packages/shared/src/bodyZones.ts)
  tracker.py          one PointingEvent per steady hold, with filters against signs (below)
  datatypes.py        BodyFrame, PointingEvent, Thresholds (tune here)
  api_client.py       posts /point and /clauses (text only) on a background thread
  signs.py            signing sessions: recorded-sign model (recognition-python) -> sign labels
  face.py             facial grammar during the signs (facial_grammar rules)
  head.py             nod / shake from the pose landmarks
  recorder.py         record new sign examples and rebuild the model (/record page)
  preview.py          local camera preview + signing/recording controls on 127.0.0.1:8765
  launcher.py         camera helper that starts at login, so a hosted page can start the camera
  lab.py              the camera program: pointing, signing, face, preview
  scripts/            fetch_models.sh downloads models/ (gitignored)
apps/recognition-python/  recorded-sign model (DTW + k-NN) used by apps/pointing/signs.py
  app/models/recorded_asl_v1/  the model the camera program loads (commit it after a rebuild)
  app/recognition/    normalize, DTW, k-NN, RecognitionPipeline
  app/scripts/        build_model.py (used by Rebuild), plus training/comparison experiments
  app/main.py         standalone webcam demo (SPACE records a sign, q quits)
apps/web/             React + Vite frontend
  src/routes/         patient, clinician, review screens
  src/language/       speech out (tone), dictation in, urgent chime
  src/components/     shared UI (bodymap/, ...)
  src/wizard/         wizard-mode operator panel
  src/lib/            event queue, API/WebSocket client
apps/api/             Node API
  src/routes/         /events, encounters, verify, chart note
  src/ws/             one WebSocket room per encounter
  src/db/             pg client and queries
packages/shared/      shared TypeScript contracts (types.ts), phrase table and sentences (language.ts), body zones, voice tone
db/schema.sql         Tiger Data schema; db/migrations/ upgrade older databases, db/seed/ for sample encounters
data/grammar/clips/   labelled facial grammar clips (feature JSON only)
```

## Running facial grammar

```
cd apps/facial_grammar && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
scripts/fetch_models.sh
.venv/bin/pytest -s                      # unit tests + per-flag accuracy on data/grammar/clips
.venv/bin/python -m facial_grammar.lab   # c calibrate, space clause, 1-4 label, s save, q quit
```

Grammar thresholds are in `apps/facial_grammar/datatypes.py`. Tune them against recorded clips.

## Running pointing

```
cd apps/pointing && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
scripts/fetch_models.sh
.venv/bin/pytest
npm run dev:api                          # in another terminal; the screens too: npm run dev:web
.venv/bin/python -m pointing.lab         # point or touch to send; space clause, p adds PAIN, q quit
.venv/bin/python -m pointing.lab --dry-run   # print events instead of posting
.venv/bin/python -m pointing.lab --no-window   # no pop-up: the camera shows on the patient web page
```

When the web app is hosted, the API can't start a program on the patient laptop, so a small camera helper does it instead. Install it once on that laptop (it starts at login and listens on `127.0.0.1:8764`, for the listed pages only); the patient page then turns the camera on and off by itself, and the camera stops when no Signapse page has checked on it for a minute:

```
.venv/bin/python -m pointing.launcher install --api https://<your-api> --origin https://<your-web-app>
.venv/bin/python -m pointing.launcher uninstall
```

In local development the API can start the camera itself instead (`LOCAL_CAMERA=true`).

The lab also serves its annotated camera on `http://127.0.0.1:8765/video` (this computer only, `--preview-port`, 0 turns it off); the patient screen shows it in a **Camera** panel, so no separate window is needed (`--no-window`). Only zone ids ever go to the API. `SIGNAPSE_API_URL` (default `http://localhost:8787`) and `SIGNAPSE_ENCOUNTER` (default the demo encounter) pick where events go. Pointing thresholds are `Thresholds` in `apps/pointing/datatypes.py`. The lab sends its clauses as statements; when sign recognition assembles real clauses it adds `PointingEvent.to_sign_event()` to the signs and takes the flag from facial grammar. Pose and hands run on the un-mirrored frame, so `lshoulder` is the patient's own left. Back zones come from the `BACK` sign (`BACK POINT-LLQ` = left lower back), since a hand behind the body can't be seen. Face parts use the pose model's eye, nose and mouth points, kept from the last 1.5 s when the hand covers the face. On the sternum the chest resolves to `chest` (both halves) rather than guessing a side; `chest`, `abdomen`, `upperback` and `lowerback` are group zones that light every part.

Filters against signs that touch the body (all in `tracker.py`, thresholds in `Thresholds`):
- **Arrive, then stop.** The hand must have moved in (on screen, or back from signing space toward the body) in the 0.8 s before the hold. A hand resting on the body never counts (`resting` in the lab).
- **Still for the whole hold.** The palm's spread over the hold window must stay small, so circling signs such as PLEASE and SORRY don't count (`moving` in the lab).
- **Touches need 0.7 s.** Signs such as MY touch the body for well under half a second.
- **Points win over touches.** Each hand has its own hold, so a hand resting on the body can't block or take over the other hand's point. While the index finger is out, a frame votes with the fingertip even if it reads as a touch, and no touch is reported while a point is in progress or just after one (`touch during point` in the lab).
- **Mid-chest is ME.** An index point at the middle of the chest is usually the pronoun ME, so it needs a 1 s hold, unless PAIN/HURT/SICK was signed in the last 3 s (`tracker.note_sign(label, t_ms)`; the lab's `p` key stands in for it).

Tuning in the lab: the overlay shows the zone, the gesture, the hold progress, fps and, for touches, `depth` (about 1.0 on the body, larger when the hand is in front). If touches fire while signing in front of the chest, lower `max_touch_depth`; if real touches are missed, raise it or check `assumed_shoulder_m`. `touch_enabled=False` turns touches off. The stats line counts why holds ended: lots of `moved` means the hand drifts more than `max_jitter` while held; lots of `lost` means the hand keeps dropping out of detection for longer than `dropout_ms`.

## The patient's path (sign model + face + Gemini)

The patient screen asks one thing at a time:

1. **Sign how you feel.** The camera and signing turn on by themselves. Each sign (hands up, sign, hands down) is matched by the recorded-sign model, and the words appear as they are read. **Done** ends it. If signing doesn't work, the patient can tap Pain, Headache, Feel sick, Fever, Dizzy or Breathing instead.
2. **Where does it hurt?** Tap the body, or point with the camera. Only for pain, and skipped if the place was already signed or pointed at.
3. **How much does it hurt?** Tap 0–10.
4. **Is this right?** "You said: I have left chest pain. It is 7 out of 10." Then **Send to the doctor** or **Start again**.

The clinician screen then gets a sentence written by Gemini from the sign labels and the face ("The patient reports pain at the left side of the chest and rates the pain 7 out of 10."). It is spoken in a tone that follows the face, the place and rating go on the pain map, and anything that depends on a facial marker keeps the **Confirm meaning** flag. Rating central pain 8 or more counts as urgent, like chest pain.

How it is wired (all in the one camera program the page starts, `apps/pointing`):
- `signs.py` loads `apps/recognition-python/app/models/recorded_asl_v1` (DTW + kNN; chest, face, fever, headache, heartattack, jaw, nausea, pain, stomach) through that app's own `RecognitionPipeline`. It flips the hand points to match the mirrored recordings, tries both hands so left-handed signers match too, and drops matches further than 2.0. Retrain with `apps/recognition-python/app/scripts/build_model.py` and the camera program picks it up on its next start.
- `face.py` runs `apps/facial_grammar`'s rules on the face during the signs. The resting face is learned while the patient isn't signing, so there is no calibration step. Its flag and `to_nmm()` scores go with the signs.
- The page controls signing with `POST http://127.0.0.1:8765/sign` (`start` / `done` / `cancel`), accepted only from the web page's origin (`CORS_ORIGIN`).
- Only sign labels and marker scores leave the program: frames, hand points and face points never do.

**Teaching it more signs:** open `/record` (linked at the bottom of the Visits page). Pick a sign (or add a new one, e.g. `dizzy`), press **Record**, sign once with your hands down before and after, and repeat 5–10 times, ideally with 2–3 people. **Rebuild model** backs up the current model to `apps/recognition-python/recorder/model_backups/`, runs `build_model.py`, shows how many examples it recognises (and which signs it mixes up), and the camera uses the new model straight away. Examples are saved as hand points only in `apps/recognition-python/recorder/recordings/` (gitignored). The first time the camera starts, the model's existing examples are copied there so rebuilds keep them. Commit the rebuilt `app/models/recorded_asl_v1/` so teammates get it. A new sign also needs adding to the patient's words (`PATIENT_VOCAB` in `packages/shared/src/patient.ts`) and the sentence rules (`language.ts`) to read well.

Setup once on each computer: `apps/pointing/scripts/fetch_models.sh` (in Git Bash on Windows) now also downloads `face_landmarker.task`. Without it, signs still work and are sent as plain statements.

## Shared contracts

- **Sign event:** label, confidence, start/end time. Wizard mode emits the same shape.
- **Clause:** the signs in one clause plus its face/head frames, which go in to produce a grammar flag.
- **Utterance event:** speaker, kind, gloss, markers, flag, sentence, confidence. This is text only, and it is the only thing that leaves the device.

## Connecting sign recognition and facial grammar

When the patient pauses after a clause, the vision process POSTs the signs and the facial-grammar result to the API's `/clauses` endpoint. That creates a **draft** (HTTP 202): for pain the patient screen asks where and how much (each answer is added to the draft's signs as `POINT-<ZONE>` and `NUM-<n>`), then shows it in plain words ("You said no. You do not have chest pain.", plus what the face showed) with **Send to the doctor** and **Start again**. Nothing is saved or sent to the clinician until the patient presses Send; the draft lives in server memory and goes to patient screens only. Then the server writes the clinical sentence (Gemini, with a rule-based fallback), saves it with how the patient confirmed it (`sent`, `edited`, or `auto_sent`, plus how many times they signed again) and pushes it to the clinician screen. Urgent drafts (e.g. chest pain) send themselves after 10 s if the patient does not answer (`URGENT_AUTOSEND_MS`), and the clinician sees "Sent automatically: patient did not answer". Add `"direct": true` to a `/clauses` body to skip the patient's check (testing and the wizard), or set `PATIENT_CONFIRM=false`. The facial "Confirm meaning" flag for the clinician is unchanged. Every patient action is logged in `patient_actions` (sign labels only).

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

Pointing: the vision process POSTs `{encounterId, zone, confidence}` to `/point`. It isn't stored, only broadcast as a `point` room message, and `usePointing` in `apps/web/src/components/bodymap/` turns it into the highlighted zone. The record is the clause gloss (`POINT-<ZONE>`, read by `complaintOf` in `packages/shared/src/language.ts`) and the pain reading the patient confirms (`source: "pointing"`). Zone ids and shapes are in `BODY_VIEWS` in `packages/shared/src/bodyZones.ts`.

## Wizard mode

For demos and testing without a camera, open `/wizard?e=<id>`. Without `?e=` it uses the newest open visit, or the demo visit if none is open. An operator plays the patient's side through the real pipeline: tap signs into a clause, pick the facial flag and send it to `/clauses`. A preview shows the clinician's sentence (`/translate`) and the patient's wording before anything is sent. Clauses go through the patient's Send/Redo/Edit check unless **Skip the patient's check** is ticked (`direct: true`). **Demo lines** send a scripted clause in one click (shift-click loads it into the builder instead); edit them in `apps/web/src/wizard/presets.ts`. The body map sends `/point` (point or touch) or adds `POINT-<ZONE>` to the clause, and **Nod**/**Shake** send `/gesture`. A live log shows drafts waiting for the patient, point/gesture/pain events and the conversation.

## Call mode

For a patient who needs to reach a hospital or doctor remotely. On the start page, choose **Call a doctor**. That starts a visit and opens `/call?e=<id>`. The patient sends the doctor the link shown there (`/call/doctor?e=<id>`). The doctor opens it in Chrome or Edge, clicks **Join call** and waits until the patient lets them in.

- **Patient → doctor:** the patient signs to the camera. `apps/pointing` posts clauses exactly as in a visit. The doctor sees each sentence as a caption over the patient's video, and it is read aloud, with a chime when it is urgent. The patient can also type.
- **Doctor → patient:** the doctor's speech is captioned live on the patient's screen in large text. Finished sentences are saved as clinician replies. A reply that ends in `?` gives the patient big YES/NO buttons.
- The call is an ordinary encounter, so the review screen and chart note cover it.

**Encryption.** Audio, video and live captions go peer to peer over WebRTC and are encrypted end to end between the two browsers (DTLS-SRTP, plus a data channel for captions). The API only relays the setup messages (`signal` in the room socket), validated and rate limited, and it never sees media or live captions. More protections:
- The patient has to **admit** the doctor, and each room allows one patient and one doctor socket, so a third person with the link is refused.
- Both screens show a **safety code** made from the two DTLS fingerprints. If the codes match, nobody, the server included, is in the middle.

The server still sees and stores the finished sentences, as it does for visits, so they can be charted. Doctor captions use on-device speech recognition when the browser offers it (`processLocally`). Otherwise the page tells the doctor that their voice goes to the browser's speech service and offers typing instead.

The sign-reading program usually holds the webcam, so the patient's call video is its local preview drawn onto a canvas. Without the program, **Video only** uses the webcam directly. Calls between networks that block direct connections need a TURN relay (`VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS`). Calls need HTTPS outside localhost.

## Privacy and safety

- **Privacy:** camera frames and landmarks are processed in the local vision process and then discarded. The API rejects anything that isn't text or numbers. The only personal data is the name typed at check-in, and it is never sent to Gemini. In call mode, the patient's video goes only to the doctor, peer to peer and encrypted (see [Call mode](#call-mode)).
- **Safety:** a wrong meaning is a clinical risk, so lines that depend on a facial marker need clinician confirmation before charting. The patient confirms every message before it is sent, except urgent ones they don't answer.
- **Demo resilience:** wizard mode drives the same pipeline without a camera, and event writes are queued so they never block the UI.

**Disclaimer:** Signapse is a hackathon prototype. It does not replace qualified medical interpreters and is not HIPAA/PHIPA compliant.

### Out of scope

Continuous or open-vocabulary sign recognition, replacing interpreters, and production compliance.

## Team

- Emily Yu ([@emilyyuuu](https://github.com/emilyyuuu))
- Noah Sun ([@LegendaryArk](https://github.com/LegendaryArk))
- Kian Davoudi ([@kian-git07](https://github.com/kian-git07))
