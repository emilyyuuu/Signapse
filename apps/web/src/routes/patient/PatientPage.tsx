import { useState } from "react";
import type { BodyView } from "@synapse/shared";
import { encounterIdFromUrl } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { BodyMap } from "../../components/bodymap/BodyMap";
import { SeverityPicker } from "../../components/bodymap/SeverityPicker";
import { PainList } from "../../components/bodymap/PainList";
import { usePainMap } from "../../components/bodymap/usePainMap";

// Patient station. Camera and sign chips come later; for now: the body map.
export function PatientPage() {
  const encounterId = encounterIdFromUrl();
  const { pain, apply, report } = usePainMap(encounterId);
  const [view, setView] = useState<BodyView>("front");
  const [selected, setSelected] = useState<string>();
  const [sendFailed, setSendFailed] = useState(false);

  // Keeps this screen in sync if another device (or the camera) reports pain.
  const { connected } = useRoom(encounterId, (msg) => {
    if (msg.type === "pain") apply(msg.data);
  });

  // One tap sets the level and closes the picker; the map shows the result.
  const pick = async (severity: number) => {
    if (!selected) return;
    const zone = selected;
    setSelected(undefined);
    setSendFailed(!(await report(zone, severity)));
  };

  return (
    <main className="page">
      <h1 style={{ marginTop: 0 }}>Where does it hurt?</h1>
      <p className="muted">Tap the body, then choose how much it hurts. {connected ? "" : "Connecting…"}</p>

      <div className="row">
        <div className="panel" style={{ flex: "0 1 280px" }}>
          <div className="seg" style={{ marginBottom: 12 }}>
            {(["front", "back"] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === "front" ? "Front" : "Back"}
              </button>
            ))}
          </div>
          <BodyMap view={view} pain={pain} selected={selected} onPick={setSelected} />
        </div>

        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 16 }}>
          {selected ? (
            <SeverityPicker zone={selected} value={pain[selected] ?? 0} onPick={pick} />
          ) : (
            <div className="panel muted">Tap a part of the body to rate the pain.</div>
          )}
          {sendFailed && (
            <p className="chip urgent" role="alert">
              Not sent. Check the connection and tap again.
            </p>
          )}
          <div className="panel">
            <PainList pain={pain} />
          </div>
        </div>
      </div>
    </main>
  );
}
