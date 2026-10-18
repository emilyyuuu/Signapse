import { useEffect, useState } from "react";
import { ZONE_LABELS, viewOf, type BodyView, type Encounter } from "@signapse/shared";
import { encounterIdFromUrl, getEncounter } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { AppShell } from "../../components/AppShell";
import { EmptyArt } from "../../components/brand";
import { PageHeader } from "../../components/PageHeader";
import { BodyMap } from "../../components/bodymap/BodyMap";
import { SeverityPicker } from "../../components/bodymap/SeverityPicker";
import { PainList } from "../../components/bodymap/PainList";
import { usePainMap } from "../../components/bodymap/usePainMap";
import { usePointing } from "../../components/bodymap/usePointing";

const VIEW_NAMES: Record<BodyView, string> = { front: "Front", back: "Back", face: "Face" };

// Patient station. Camera and sign chips come later; for now: the body map.
export function PatientPage() {
  const encounterId = encounterIdFromUrl();
  const { pain, apply, report } = usePainMap(encounterId);
  const [view, setView] = useState<BodyView>("front");
  const [selected, setSelected] = useState<string>();
  const [sendFailed, setSendFailed] = useState(false);
  const { pointed, handle: handlePoint, clear: clearPoint } = usePointing();
  // The selection came from the camera, so the reading is saved as "pointing".
  const [fromPointing, setFromPointing] = useState(false);

  const [encounter, setEncounter] = useState<Encounter>();

  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => setEncounter(h.encounter))
      .catch((err) => console.warn(err));
  }, [encounterId]);

  // Keeps this screen in sync if another device (or the camera) reports pain.
  // Pointing at a body part opens the pain level for it straight away.
  const { connected } = useRoom(encounterId, (msg) => {
    if (msg.type === "pain") apply(msg.data);
    if (msg.type === "ended") setEncounter(msg.data);
    const zone = handlePoint(msg);
    if (zone) {
      setView(viewOf(zone));
      setSelected(zone);
      setFromPointing(true);
    }
  });

  // One tap sets the level and closes the picker; the map shows the result.
  const pick = async (severity: number) => {
    if (!selected) return;
    const zone = selected;
    const source = fromPointing ? "pointing" : "tap";
    setSelected(undefined);
    setFromPointing(false);
    clearPoint();
    setSendFailed(!(await report(zone, severity, source)));
  };

  // Tapping another zone corrects a misread point.
  const tap = (zone: string) => {
    clearPoint();
    setSelected(zone);
    setFromPointing(false);
  };

  if (encounter?.endedAt) {
    return (
      <AppShell screen="patient" encounter={encounter}>
        <section className="panel empty" style={{ maxWidth: 560, margin: "40px auto", padding: "40px 24px" }}>
          <EmptyArt icon="chat" />
          <h1 className="page-title">This visit has ended</h1>
          <p style={{ fontSize: 19, margin: 0, color: "var(--ink)" }}>Thank you. A staff member will be with you.</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell screen="patient" encounter={encounter} connected={connected}>
      <PageHeader title="Where does it hurt?">Tap the body or point to where it hurts, then choose how much.</PageHeader>

      <div className="row">
        <div className="panel pop pop-blue bodycard" style={{ flex: "0 1 340px" }}>
          <div className="seg" style={{ marginBottom: 14 }}>
            {(["front", "back", "face"] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {VIEW_NAMES[v]}
              </button>
            ))}
          </div>
          <BodyMap
            view={view}
            pain={pain}
            selected={selected}
            highlighted={pointed?.zone}
            tentative={pointed?.gesture === "touch"}
            onPick={tap}
          />
        </div>

        <div style={{ flex: "1 1 360px", display: "flex", flexDirection: "column", gap: 18 }}>
          {fromPointing && selected && (
            <p className="callout" role="status">
              You {pointed?.gesture === "touch" ? "touched" : "pointed to"} your {ZONE_LABELS[selected].toLowerCase()}.
              Choose how much it hurts to confirm, or tap the correct place.
            </p>
          )}
          {selected ? (
            <SeverityPicker zone={selected} value={pain[selected] ?? 0} onPick={pick} />
          ) : (
            <div className="panel empty">
              <EmptyArt icon="body" />
              <p style={{ fontSize: 20, color: "var(--ink)", margin: 0 }}>Tap a part of the body to tell us how it feels.</p>
            </div>
          )}
          {sendFailed && (
            <p className="chip urgent" role="alert">
              Not sent. Check the connection and tap again.
            </p>
          )}
          <div className="panel">
            <h2 className="section-title">Your pain</h2>
            <PainList pain={pain} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
