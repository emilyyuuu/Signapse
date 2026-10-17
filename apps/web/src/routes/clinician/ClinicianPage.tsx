import { useEffect, useState } from "react";
import {
  assessPriority,
  describeFace,
  needsConfirmation,
  type GrammarFlag,
  type StoredUtterance,
} from "@synapse/shared";
import { speak, speechSupported, unlockVoice } from "../../language/speak";
import { chime, unlockChime } from "../../language/chime";
import { encounterIdFromUrl, getEncounter } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { BodyMap } from "../../components/bodymap/BodyMap";
import { PainList } from "../../components/bodymap/PainList";
import { usePainMap } from "../../components/bodymap/usePainMap";

const FLAG_LABEL: Record<GrammarFlag, string> = {
  statement: "Statement",
  question: "Question",
  negation: "Denial",
  intensified: "Emphasis",
};

// Urgency, confirmation and the face summary are worked out here with the same
// shared rules the server uses, so history and live lines are treated alike.
function assess(u: StoredUtterance) {
  const signed = u.speaker === "patient" && u.kind === "sign" && u.gloss && u.grammarFlag;
  return {
    urgent: signed ? assessPriority(u.gloss!, u.grammarFlag!) === "urgent" : false,
    confirm: signed ? needsConfirmation(u.grammarFlag, u.confidence) : false,
    face:
      u.grammarFlag && (u.nmm || u.grammarFlag !== "statement")
        ? describeFace(u.nmm, u.grammarFlag).summary
        : undefined,
  };
}

const keyOf = (u: StoredUtterance) => `${u.ts}|${u.sentence}`;

function merge(a: StoredUtterance[], b: StoredUtterance[]) {
  const byKey = new Map([...a, ...b].map((u) => [keyOf(u), u]));
  return [...byKey.values()].sort((x, y) => x.ts.localeCompare(y.ts));
}

function spokenText(u: StoredUtterance) {
  return assess(u).confirm ? `${u.sentence} Please confirm with the patient.` : u.sentence;
}

// Clinician screen: each sentence with its facial grammar, an urgent banner
// with chime and voice, and the patient's body map, all live.
export function ClinicianPage() {
  const encounterId = encounterIdFromUrl();
  const [lines, setLines] = useState<StoredUtterance[]>([]);
  const [alert, setAlert] = useState<StoredUtterance | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const { pain, apply } = usePainMap(encounterId);

  // Past sentences, so a refresh doesn't empty the log.
  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => setLines((prev) => merge(h.utterances, prev)))
      .catch((err) => console.warn(err));
  }, [encounterId]);

  const { connected } = useRoom(encounterId, (msg) => {
    if (msg.type === "pain") {
      apply(msg.data);
      return;
    }
    const u = msg.data;
    setLines((prev) => merge(prev, [u]));
    const { urgent } = assess(u);
    if (urgent) setAlert(u);
    if (voiceOn && u.speaker === "patient") {
      const wait = urgent ? chime() : 0;
      setTimeout(() => speak(spokenText(u), { urgent }), wait);
    }
  });

  const latest = lines.at(-1);

  return (
    <main className="page">
      {alert && (
        <div className="banner" role="alert">
          <span>URGENT: {alert.sentence}</span>
          <button className="btn" onClick={() => setAlert(null)}>
            Acknowledge
          </button>
        </div>
      )}

      <h1 style={{ marginTop: 0 }}>Clinician</h1>
      <p className="muted">
        Encounter <code>{encounterId}</code> · {connected ? "live" : "connecting…"}
      </p>

      {!speechSupported ? (
        <p>This browser has no built-in voice. Sentences are shown as text only.</p>
      ) : (
        <button
          className="btn"
          onClick={() => {
            if (!voiceOn) {
              unlockVoice();
              unlockChime();
            }
            setVoiceOn(!voiceOn);
          }}
        >
          {voiceOn ? "Sound on (click to mute)" : "Enable sound"}
        </button>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <section className="panel" style={{ flex: "1 1 400px" }}>
          {latest ? (
            <>
              <p style={{ fontSize: 26, fontWeight: 600, margin: "0 0 12px" }}>{latest.sentence}</p>
              <button
                className="btn"
                onClick={() => speak(spokenText(latest), { urgent: assess(latest).urgent })}
                disabled={!speechSupported}
              >
                Speak again
              </button>
            </>
          ) : (
            <p className="muted">Waiting for the patient…</p>
          )}

          <ol className="lines" reversed>
            {[...lines].reverse().map((u) => (
              <UtteranceLine key={keyOf(u)} u={u} />
            ))}
          </ol>
        </section>

        <section className="panel" style={{ flex: "1 1 320px" }} aria-label="Patient body map">
          <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Pain map</h2>
          <div className="row" style={{ gap: 8 }}>
            {(["front", "back"] as const).map((v) => (
              <figure key={v} style={{ margin: 0, flex: "1 1 120px", maxWidth: 170 }}>
                <BodyMap view={v} pain={pain} />
                <figcaption className="muted" style={{ textAlign: "center" }}>
                  {v === "front" ? "Front" : "Back"}
                </figcaption>
              </figure>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <PainList pain={pain} />
          </div>
        </section>
      </div>
    </main>
  );
}

function UtteranceLine({ u }: { u: StoredUtterance }) {
  const { urgent, confirm, face } = assess(u);
  return (
    <li className={`line${urgent ? " urgent" : ""}`}>
      <div>{u.sentence}</div>
      <div className="meta">
        <small className="muted">{new Date(u.ts).toLocaleTimeString()}</small>
        {urgent && <span className="chip urgent">Urgent</span>}
        {u.grammarFlag && <span className="chip flag">{FLAG_LABEL[u.grammarFlag]}</span>}
        {confirm && <span className="chip confirm">⚠ Confirm meaning</span>}
        {u.gloss && <span className="gloss">{u.gloss.join(" ")}</span>}
      </div>
      {face && <div className="face">Face: {face}</div>}
    </li>
  );
}
