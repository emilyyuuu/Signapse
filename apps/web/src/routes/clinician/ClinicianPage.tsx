import { useEffect, useRef, useState } from "react";
import { DEMO_ENCOUNTER_ID, type RoomMessage, type StoredUtterance } from "@synapse/shared";
import { speak, speechSupported, unlockVoice } from "../../language/speak";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

// Bare clinician screen: shows each sentence from the encounter's WebSocket
// room and reads it aloud. Styling, flags and priority come in later steps.
export function ClinicianPage() {
  const encounterId = new URLSearchParams(location.search).get("e") ?? DEMO_ENCOUNTER_ID;
  const [lines, setLines] = useState<StoredUtterance[]>([]);
  const [connected, setConnected] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws?encounter=${encounterId}`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as RoomMessage;
        if (msg.type !== "utterance") return;
        setLines((prev) => [...prev, msg.data]);
        if (voiceOnRef.current && msg.data.speaker === "patient") speak(msg.data.sentence);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.close();
    };
  }, [encounterId]);

  const latest = lines.at(-1);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1>Clinician</h1>
      <p>
        Encounter <code>{encounterId}</code> · {connected ? "live" : "connecting…"}
      </p>

      {!speechSupported ? (
        <p>This browser has no built-in voice. Sentences are shown as text only.</p>
      ) : (
        <button
          onClick={() => {
            if (!voiceOn) unlockVoice();
            setVoiceOn(!voiceOn);
          }}
        >
          {voiceOn ? "Voice on (click to mute)" : "Enable voice"}
        </button>
      )}

      {latest && (
        <section style={{ marginTop: 24 }}>
          <p style={{ fontSize: 26, fontWeight: 600 }}>{latest.sentence}</p>
          <button onClick={() => speak(latest.sentence)} disabled={!speechSupported}>
            Speak again
          </button>
        </section>
      )}

      <ol style={{ marginTop: 24 }}>
        {lines.map((l) => (
          <li key={l.ts + l.sentence}>
            <small>{new Date(l.ts).toLocaleTimeString()}</small> {l.sentence}
          </li>
        ))}
      </ol>
    </main>
  );
}
