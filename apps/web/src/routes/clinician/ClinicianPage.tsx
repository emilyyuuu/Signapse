import { useState } from "react";
import type { StoredUtterance } from "@synapse/shared";
import { speak, speechSupported, unlockVoice } from "../../language/speak";
import { encounterIdFromUrl } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { BodyMap } from "../../components/bodymap/BodyMap";
import { PainList } from "../../components/bodymap/PainList";
import { usePainMap } from "../../components/bodymap/usePainMap";

// Clinician screen: each sentence from the encounter is shown and read aloud,
// and the patient's body map updates live. Flags and priority come later.
export function ClinicianPage() {
  const encounterId = encounterIdFromUrl();
  const [lines, setLines] = useState<StoredUtterance[]>([]);
  const [voiceOn, setVoiceOn] = useState(false);
  const { pain, apply } = usePainMap(encounterId);

  const { connected } = useRoom(encounterId, (msg) => {
    if (msg.type === "pain") {
      apply(msg.data);
      return;
    }
    setLines((prev) => [...prev, msg.data]);
    if (voiceOn && msg.data.speaker === "patient") speak(msg.data.sentence);
  });

  const latest = lines.at(-1);

  return (
    <main className="page">
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
            if (!voiceOn) unlockVoice();
            setVoiceOn(!voiceOn);
          }}
        >
          {voiceOn ? "Voice on (click to mute)" : "Enable voice"}
        </button>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <section className="panel" style={{ flex: "1 1 360px" }}>
          {latest ? (
            <>
              <p style={{ fontSize: 26, fontWeight: 600, margin: "0 0 12px" }}>{latest.sentence}</p>
              <button className="btn" onClick={() => speak(latest.sentence)} disabled={!speechSupported}>
                Speak again
              </button>
            </>
          ) : (
            <p className="muted">Waiting for the patient…</p>
          )}
          <ol style={{ marginTop: 24 }}>
            {lines.map((l) => (
              <li key={l.ts + l.sentence}>
                <small className="muted">{new Date(l.ts).toLocaleTimeString()}</small> {l.sentence}
              </li>
            ))}
          </ol>
        </section>

        <section className="panel" style={{ flex: "1 1 360px" }} aria-label="Patient body map">
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
