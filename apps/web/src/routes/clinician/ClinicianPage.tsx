import { useEffect, useState } from "react";
import { assessUtterance, type StoredUtterance } from "@synapse/shared";
import { speak, speechSupported, unlockVoice } from "../../language/speak";
import { chime, unlockChime } from "../../language/chime";
import { encounterIdFromUrl, getEncounter, verifyUtterance } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { BodyMap } from "../../components/bodymap/BodyMap";
import { PainList } from "../../components/bodymap/PainList";
import { usePainMap } from "../../components/bodymap/usePainMap";
import { UtteranceLine, mergeLines } from "../../components/conversation/UtteranceLine";

function spokenText(u: StoredUtterance) {
  return assessUtterance(u).needsConfirm ? `${u.sentence} Please confirm with the patient.` : u.sentence;
}

// Clinician screen: each sentence with its facial grammar, an urgent banner
// with chime and voice, confirm buttons, and the patient's body map, all live.
export function ClinicianPage() {
  const encounterId = encounterIdFromUrl();
  const [lines, setLines] = useState<StoredUtterance[]>([]);
  const [clinicianId, setClinicianId] = useState<string>();
  const [alert, setAlert] = useState<StoredUtterance | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const { pain, apply } = usePainMap(encounterId);

  // Past sentences, so a refresh doesn't empty the log.
  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => {
        setClinicianId(h.encounter.clinicianId);
        setLines((prev) => mergeLines(h.utterances, prev));
      })
      .catch((err) => console.warn(err));
  }, [encounterId]);

  const { connected } = useRoom(encounterId, (msg) => {
    if (msg.type === "pain") {
      apply(msg.data);
      return;
    }
    const u = msg.data;
    setLines((prev) => mergeLines(prev, [u]));
    if (msg.type === "verified") return; // an existing line was confirmed; no alert or voice
    const { urgent } = assessUtterance(u);
    if (urgent) setAlert(u);
    if (voiceOn && u.speaker === "patient") {
      const wait = urgent ? chime() : 0;
      setTimeout(() => speak(spokenText(u), { urgent }), wait);
    }
  });

  const confirm = async (id: string) => {
    const row = await verifyUtterance(id, clinicianId ?? "clinician");
    if (row) setLines((prev) => mergeLines(prev, [row]));
    return !!row;
  };

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
        Encounter <code>{encounterId}</code> · {connected ? "live" : "connecting…"} ·{" "}
        <a href={`/review?e=${encounterId}`}>Review and chart note</a>
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
                onClick={() => speak(spokenText(latest), { urgent: assessUtterance(latest).urgent })}
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
              <UtteranceLine key={u.id} u={u} onConfirm={confirm} />
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
