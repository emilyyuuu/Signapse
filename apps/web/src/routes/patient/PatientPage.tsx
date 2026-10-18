import { useEffect, useState } from "react";
import { ZONE_LABELS, type BodyView, type Encounter } from "@signapse/shared";
import { encounterIdFromUrl, getEncounter } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { AppShell } from "../../components/AppShell";
import { EmptyArt } from "../../components/brand";
import { PageHeader } from "../../components/PageHeader";
import { CameraPanel } from "../../components/camera/CameraPanel";
import { BodyMap } from "../../components/bodymap/BodyMap";
import { SeverityPicker } from "../../components/bodymap/SeverityPicker";
import { PainList } from "../../components/bodymap/PainList";
import { PointConfirm } from "../../components/bodymap/PointConfirm";
import { usePainFlow } from "../../components/bodymap/usePainFlow";

const VIEW_NAMES: Record<BodyView, string> = { front: "Front", back: "Back", face: "Face" };

// Patient station. Camera and sign chips come later; for now: the body map.
export function PatientPage() {
  const encounterId = encounterIdFromUrl();
  const flow = usePainFlow(encounterId);
  const { pain, view, setView, selected, pointed, fromPointing, signed, sendFailed, pick, tap } = flow;

  const [encounter, setEncounter] = useState<Encounter>();

  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => setEncounter(h.encounter))
      .catch((err) => console.warn(err));
  }, [encounterId]);

  // Keeps this screen in sync if another device (or the camera) reports pain.
  const { connected } = useRoom(encounterId, (msg) => {
    if (msg.type === "ended") setEncounter(msg.data);
    flow.handle(msg);
  });

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
          {signed && !selected && (
            <p className="callout" role="status">
              We understood <strong>{signed.level} out of 10</strong> for your {ZONE_LABELS[signed.zone].toLowerCase()} from your
              signing. If that is wrong, tap the place again and choose a number.
            </p>
          )}
          {pointed && !selected && (
            <PointConfirm zone={pointed.zone} onYes={flow.confirmPointed} onNo={flow.cancelPointed} />
          )}
          {fromPointing && selected && (
            <p className="callout" role="status">
              You {pointed?.gesture === "touch" ? "touched" : "pointed to"} your {ZONE_LABELS[selected].toLowerCase()}.
              Choose how much it hurts to confirm, or tap the correct place.
            </p>
          )}
          {selected ? (
            <SeverityPicker zone={selected} value={pain[selected] ?? 0} onPick={pick} />
          ) : pointed ? null : (
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
          <CameraPanel encounterId={encounterId} lookingAt={pointed && !selected ? ZONE_LABELS[pointed.zone] : undefined} />
          <div className="panel">
            <h2 className="section-title">Your pain</h2>
            <PainList pain={pain} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
