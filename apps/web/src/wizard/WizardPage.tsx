import { useEffect, useRef, useState } from "react";
import {
  DEMO_ENCOUNTER_ID,
  MEANING_CHOICES,
  PATIENT_VOCAB,
  ZONE_LABELS,
  patientSentence,
  pointGloss,
  signText,
  type BodyView,
  type DraftView,
  type Encounter,
  type GrammarFlag,
  type SignEvent,
  type StoredUtterance,
  type TranslateResult,
} from "@signapse/shared";
import {
  getEncounter,
  listActiveEncounters,
  postGesture,
  postPoint,
  previewClause,
  sendClause,
} from "../lib/api";
import { useRoom } from "../lib/useRoom";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/brand";
import { PageHeader } from "../components/PageHeader";
import { BodyMap } from "../components/bodymap/BodyMap";
import { FLAG_LABEL, UtteranceLine, mergeLines } from "../components/conversation/UtteranceLine";
import { PRESETS, type Preset } from "./presets";

const LEVELS = Array.from({ length: 11 }, (_, n) => `NUM-${n}`);
const VIEWS: BodyView[] = ["front", "back", "face"];
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface LiveEvent {
  id: number;
  ts: string;
  text: string;
}

// Signs as if sign recognition had produced them: one after another, 600 ms each.
function asSigns(gloss: string[], confidence: number): SignEvent[] {
  const start = Date.now() - gloss.length * 600;
  return gloss.map((label, i) => ({ label, confidence, startMs: start + i * 600, endMs: start + (i + 1) * 600 }));
}

// Wizard mode: an operator plays the patient's signs, facial grammar, pointing and
// nods through the real pipeline (/clauses, /point, /gesture), so the demo works
// end to end without the camera. Clauses go to the patient's check unless skipped.
export function WizardPage() {
  const fromUrl = new URLSearchParams(location.search).get("e");
  const [encounterId, setEncounterId] = useState(fromUrl ?? DEMO_ENCOUNTER_ID);
  const [visits, setVisits] = useState<Encounter[]>([]);
  const [encounter, setEncounter] = useState<Encounter>();
  const [lines, setLines] = useState<StoredUtterance[]>([]);
  const [drafts, setDrafts] = useState<DraftView[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const nextEvent = useRef(0);

  const [gloss, setGloss] = useState<string[]>([]);
  const [flag, setFlag] = useState<GrammarFlag>("statement");
  const [confidence, setConfidence] = useState(0.9);
  const [direct, setDirect] = useState(false);
  const [preview, setPreview] = useState<TranslateResult | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [view, setView] = useState<BodyView>("front");
  const [zone, setZone] = useState<string>();
  const [touch, setTouch] = useState(false);

  // Without ?e= in the URL, use the newest open visit (else the demo visit).
  useEffect(() => {
    listActiveEncounters()
      .then((list) => {
        setVisits(list);
        if (!fromUrl && list[0]) setEncounterId(list[0].encounterId);
      })
      .catch((err) => console.warn(err));
  }, [fromUrl]);

  useEffect(() => {
    setLines([]);
    setDrafts([]);
    getEncounter(encounterId)
      .then((h) => {
        setEncounter(h.encounter);
        setLines((prev) => mergeLines(h.utterances, prev));
      })
      .catch((err) => console.warn(err));
  }, [encounterId]);

  const log = (text: string, ts = new Date().toISOString()) =>
    setEvents((prev) => [{ id: nextEvent.current++, ts, text }, ...prev].slice(0, 12));

  // Joins as a patient screen so drafts waiting for the patient show up here too.
  const { connected } = useRoom(
    encounterId,
    (msg) => {
      switch (msg.type) {
        case "utterance":
        case "verified":
          setLines((prev) => mergeLines(prev, [msg.data]));
          break;
        case "draft":
          setDrafts((prev) => [...prev.filter((d) => d.id !== msg.data.id), msg.data]);
          break;
        case "draft_closed":
          setDrafts((prev) => prev.filter((d) => d.id !== msg.data.id));
          log(`Patient check: ${msg.data.action.replace("_", " ")}`);
          break;
        case "point":
          log(`${msg.data.gesture === "touch" ? "Touch" : "Point"}: ${ZONE_LABELS[msg.data.zone] ?? msg.data.zone}`, msg.data.ts);
          break;
        case "gesture":
          log(msg.data.gesture === "nod" ? "Nod" : "Head shake", msg.data.ts);
          break;
        case "pain":
          log(`Pain: ${ZONE_LABELS[msg.data.zone] ?? msg.data.zone} ${msg.data.severity}/10`, msg.data.ts);
          break;
        case "encounter":
        case "ended":
          setEncounter(msg.data);
          break;
      }
    },
    { role: "patient" },
  );

  // Live preview of the clinical sentence; a newer clause wins over a slow answer.
  useEffect(() => {
    if (gloss.length === 0) {
      setPreview(null);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      previewClause(gloss, flag, confidence).then((p) => !stale && setPreview(p));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [gloss, flag, confidence]);

  const ended = !!encounter?.endedAt;
  const disabled = ended || busy;

  const send = async (g: string[], f: GrammarFlag) => {
    setBusy(true);
    setStatus(null);
    const res = await sendClause(encounterId, asSigns(g, confidence), f, undefined, { direct });
    setBusy(false);
    if (!res) {
      setStatus({ ok: false, text: "Not sent. Check the API is running and the visit is open (see the console)." });
      return false;
    }
    setStatus({
      ok: true,
      text: `${g.join(" ")} (${FLAG_LABEL[f]}) ${"status" in res ? "is waiting for the patient to check" : "was sent to the clinician"}.`,
    });
    return true;
  };

  const sendBuilt = async () => {
    if (await send(gloss, flag)) setGloss([]);
  };

  const runPreset = (p: Preset, load: boolean) => {
    if (load) {
      setGloss(p.gloss);
      setFlag(p.flag);
    } else {
      void send(p.gloss, p.flag);
    }
  };

  const add = (token: string) => setGloss((prev) => (prev.length < 20 ? [...prev, token] : prev));
  const remove = (i: number) => setGloss((prev) => prev.filter((_, j) => j !== i));
  const moveLeft = (i: number) =>
    setGloss((prev) => (i === 0 ? prev : [...prev.slice(0, i - 1), prev[i], prev[i - 1], ...prev.slice(i + 1)]));

  const point = async () => {
    if (!zone) return;
    const ok = await postPoint({ encounterId, zone, confidence, gesture: touch ? "touch" : "point" });
    if (!ok) setStatus({ ok: false, text: "Point not sent." });
  };

  const gesture = async (g: "nod" | "shake") => {
    if (!(await postGesture({ encounterId, gesture: g, confidence }))) setStatus({ ok: false, text: "Gesture not sent." });
  };

  return (
    <AppShell screen="wizard" encounter={encounter} connected={connected}>
      {ended && (
        <div className="ended" role="status">
          This visit has ended. Pick an open visit to keep going.
        </div>
      )}

      <PageHeader
        greet="Operator panel"
        title="Wizard mode"
        aside={
          visits.length > 0 && (
            <select
              className="input"
              aria-label="Visit"
              value={encounterId}
              onChange={(e) => (location.href = `/wizard?e=${e.target.value}`)}
            >
              {!visits.some((v) => v.encounterId === encounterId) && (
                <option value={encounterId}>{encounter?.patientRef ?? "This visit"}</option>
              )}
              {visits.map((v) => (
                <option key={v.encounterId} value={v.encounterId}>
                  {v.patientName ?? v.patientRef} · {new Date(v.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </option>
              ))}
            </select>
          )
        }
      >
        Plays the patient's signs, face, pointing and nods through the real pipeline, exactly as the camera would.
      </PageHeader>

      <div className="row wiz">
        <div className="wiz-col">
          <section className="panel">
            <h2 className="section-title">Demo lines</h2>
            <p className="muted wiz-hint">Click to send. Shift-click loads it into the clause instead.</p>
            <div className="wiz-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className="btn small white"
                  disabled={disabled}
                  title={`${p.gloss.join(" ")} · ${FLAG_LABEL[p.flag]}`}
                  onClick={(e) => runPreset(p, e.shiftKey)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2 className="section-title">Build a clause</h2>
            <div className="wiz-palette">
              {PATIENT_VOCAB.map((v) => (
                <button key={v.token} className="btn small" disabled={disabled} onClick={() => add(v.token)}>
                  {v.text}
                </button>
              ))}
            </div>
            <div className="wiz-palette">
              <span className="muted wiz-hint">Pain level</span>
              {LEVELS.map((t, n) => (
                <button key={t} className="btn small" disabled={disabled} onClick={() => add(t)}>
                  {n}
                </button>
              ))}
            </div>

            <div className="wiz-clause" aria-label="Clause">
              {gloss.length === 0 ? (
                <span className="muted">Tap signs to add them.</span>
              ) : (
                gloss.map((t, i) => (
                  <span key={i} className="wiz-chip">
                    {i > 0 && (
                      <button aria-label={`Move ${t} left`} onClick={() => moveLeft(i)}>
                        ‹
                      </button>
                    )}
                    <code>{t}</code>
                    <button aria-label={`Remove ${t}`} onClick={() => remove(i)}>
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="seg wiz-flags" role="group" aria-label="Facial grammar">
              {MEANING_CHOICES.map((m) => (
                <button key={m.flag} aria-pressed={flag === m.flag} onClick={() => setFlag(m.flag)} title={m.text}>
                  {FLAG_LABEL[m.flag]}
                </button>
              ))}
            </div>

            <label className="wiz-field">
              <span className="muted">Confidence {confidence.toFixed(2)}</span>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
              />
            </label>
            <label className="wiz-field">
              <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
              <span>Skip the patient's check (send straight to the clinician)</span>
            </label>

            <div className="wiz-actions">
              <button className="btn dark" disabled={disabled || gloss.length === 0} onClick={sendBuilt}>
                <Icon name="arrow" size={16} />
                Send clause
              </button>
              <button className="btn quiet" disabled={gloss.length === 0} onClick={() => setGloss([])}>
                Clear
              </button>
            </div>
            {status && (
              <p className={status.ok ? "muted" : "wiz-error"} role="status">
                {status.text}
              </p>
            )}
          </section>
        </div>

        <div className="wiz-col">
          <section className="panel pop pop-blue" aria-live="polite">
            <h2 className="section-title">Preview</h2>
            {gloss.length === 0 ? (
              <p className="muted">The clinician's sentence and the patient's wording show here.</p>
            ) : (
              <>
                <p className="wiz-label muted">Clinician hears</p>
                <p className="wiz-sentence">{preview?.sentence ?? "…"}</p>
                {preview && (
                  <div className="meta-line">
                    {preview.priority === "urgent" && (
                      <span className="chip urgent">
                        <Icon name="alert" size={12} /> Urgent
                      </span>
                    )}
                    {preview.needsConfirm && <span className="chip confirm">Needs confirming</span>}
                    <span className="chip flag">{preview.source === "gemini" ? "Gemini" : "Template"}</span>
                  </div>
                )}
                <p className="wiz-label muted">Patient sees</p>
                <p>{patientSentence(gloss, flag)}</p>
                <p className="muted wiz-hint">{gloss.map(signText).join(" · ")}</p>
              </>
            )}
          </section>

          <section className="panel">
            <h2 className="section-title">Point and nod</h2>
            <div className="seg" role="group" aria-label="Body view">
              {VIEWS.map((v) => (
                <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === "front" ? "Front" : v === "back" ? "Back" : "Face"}
                </button>
              ))}
            </div>
            <div className="wiz-map">
              <BodyMap view={view} pain={{}} selected={zone} onPick={setZone} />
            </div>
            <p className="muted wiz-hint">{zone ? ZONE_LABELS[zone] : "Pick a body part."}</p>
            <label className="wiz-field">
              <input type="checkbox" checked={touch} onChange={(e) => setTouch(e.target.checked)} />
              <span>Touch instead of point (needs the patient to confirm)</span>
            </label>
            <div className="wiz-actions">
              <button className="btn dark" disabled={disabled || !zone} onClick={point}>
                {touch ? "Send touch" : "Send point"}
              </button>
              <button className="btn" disabled={disabled || !zone} onClick={() => zone && add(pointGloss(zone))}>
                Add to clause
              </button>
            </div>
            <div className="wiz-actions">
              <button className="btn" disabled={disabled} onClick={() => gesture("nod")}>
                <Icon name="check" size={16} /> Nod
              </button>
              <button className="btn" disabled={disabled} onClick={() => gesture("shake")}>
                Shake head
              </button>
            </div>
          </section>
        </div>

        <div className="wiz-col">
          {drafts.length > 0 && (
            <section className="panel pop pop-yellow">
              <h2 className="section-title">Waiting for the patient</h2>
              <ul className="lines">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <div>{d.patientText}</div>
                    <small className="muted">
                      <code>{d.gloss.join(" ")}</code> · {FLAG_LABEL[d.grammarFlag]}
                      {d.urgent && " · urgent, sends itself"}
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {events.length > 0 && (
            <section className="panel">
              <h2 className="section-title">Live events</h2>
              <ul className="lines">
                {events.map((e) => (
                  <li key={e.id} className="wiz-event">
                    <small className="muted">{time(e.ts)}</small> {e.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel chat-panel">
            <div className="section-head" style={{ marginTop: 0 }}>
              <h2 className="section-title">Conversation</h2>
              <span className="muted">{lines.length} {lines.length === 1 ? "line" : "lines"}</span>
            </div>
            {lines.length === 0 ? (
              <p className="muted">Nothing sent yet.</p>
            ) : (
              <ol className="chat">
                {[...lines].reverse().map((u) => (
                  <UtteranceLine key={u.id} u={u} self="patient" />
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
