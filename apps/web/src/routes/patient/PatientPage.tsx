import { useEffect, useState } from "react";
import {
  ZONE_LABELS,
  signedLevel,
  viewOf,
  type BodyView,
  type DraftView,
  type Encounter,
  type GrammarFlag,
  type PatientAction,
} from "@signapse/shared";
import { checkIn, editDraft, encounterIdFromUrl, getEncounter, holdDraft, redoDraft, sendDraft } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { AppShell } from "../../components/AppShell";
import { EmptyArt } from "../../components/brand";
import { PageHeader } from "../../components/PageHeader";
import { CameraPanel } from "../../components/camera/CameraPanel";
import { DraftCard } from "../../components/draft/DraftCard";
import { CheckIn } from "../../components/visit/CheckIn";
import { BodyMap } from "../../components/bodymap/BodyMap";
import { SeverityPicker } from "../../components/bodymap/SeverityPicker";
import { PainList } from "../../components/bodymap/PainList";
import { usePainMap } from "../../components/bodymap/usePainMap";
import { usePointing } from "../../components/bodymap/usePointing";

const OUTCOME_TEXT: Record<PatientAction, string> = {
  sent: "Sent to the doctor.",
  edited: "Sent to the doctor.",
  auto_sent: "This was urgent, so it was sent to the doctor.",
  redone: "OK. Sign it again.",
};

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
  // Set when the level came from a signed number, so the patient can check it.
  const [signed, setSigned] = useState<{ zone: string; level: number }>();

  const [encounter, setEncounter] = useState<Encounter>();
  // A signed clause waiting for the patient to check it, and the outcome shown afterwards.
  const [draft, setDraft] = useState<DraftView>();
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string>();
  const [outcome, setOutcome] = useState<string>();
  // Check-in: the patient types their name first. Skipping is remembered for this tab.
  const skipKey = `signapse.skipCheckin.${encounterId}`;
  const [skipped, setSkipped] = useState(() => {
    try {
      return sessionStorage.getItem(skipKey) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => setEncounter(h.encounter))
      .catch((err) => console.warn(err));
  }, [encounterId]);

  // Keeps this screen in sync if another device (or the camera) reports pain.
  // Pointing at a body part opens the pain level for it straight away.
  const { connected } = useRoom(
    encounterId,
    (msg) => {
    if (msg.type === "pain") apply(msg.data);
    if (msg.type === "ended" || msg.type === "encounter") setEncounter(msg.data);
    if (msg.type === "draft") {
      setDraft(msg.data);
      setDraftError(undefined);
      setOutcome(undefined);
    }
    if (msg.type === "draft_closed") {
      setDraft((d) => (d && d.id === msg.data.id ? undefined : d));
      setDraftBusy(false);
      setOutcome(OUTCOME_TEXT[msg.data.action]);
    }
    // A signed number sets the level for the body part that is selected.
    if (msg.type === "utterance" && msg.data.speaker === "patient" && msg.data.gloss && selected) {
      const level = signedLevel(msg.data.gloss);
      if (level !== undefined) {
        setSigned({ zone: selected, level });
        void pick(level);
        return;
      }
    }
    const zone = handlePoint(msg);
    if (zone) {
      // Pointing only shows what the camera found. A nod confirms it and opens the pain scale.
      setView(viewOf(zone));
      setSelected(undefined);
      setFromPointing(false);
    }
    if (msg.type === "gesture") {
      if (msg.data.gesture === "nod" && pointed && !selected) confirmPointed();
      if (msg.data.gesture === "shake") cancelPointed();
    }
  },
    "patient",
  );

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

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setDraftBusy(true);
    setDraftError(undefined);
    const res = await fn();
    if (!res.ok) setDraftError(res.error);
    setDraftBusy(false);
  };
  const onSend = () => draft && run(() => sendDraft(encounterId, draft.id));
  const onRedo = () => draft && run(() => redoDraft(encounterId, draft.id));
  const onEdit = (change: { gloss?: string[]; grammarFlag?: GrammarFlag }) =>
    draft && run(() => editDraft(encounterId, draft.id, change));
  const onHold = () => {
    if (draft) void holdDraft(encounterId, draft.id);
  };

  // Nod, or the Yes button: the body part the camera found is right, so ask for the number.
  const confirmPointed = () => {
    if (!pointed) return;
    setSelected(pointed.zone);
    setFromPointing(true);
  };

  // Shake, or the No button: that was not it. Clear it so the patient can point again.
  const cancelPointed = () => {
    clearPoint();
    if (fromPointing) setSelected(undefined);
    setFromPointing(false);
  };

  // Tapping another zone corrects a misread point.
  const tap = (zone: string) => {
    clearPoint();
    setSigned(undefined);
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

  if (encounter && !encounter.patientName && !skipped) {
    return (
      <AppShell screen="patient" encounter={encounter} connected={connected}>
        <CheckIn
          onSubmit={async (name) => {
            const res = await checkIn(encounterId, name);
            if (res.ok && res.encounter) setEncounter(res.encounter);
            return res.ok ? undefined : res.error;
          }}
          onSkip={() => {
            try {
              sessionStorage.setItem(skipKey, "1");
            } catch {
              /* storage unavailable: skipping lasts until reload */
            }
            setSkipped(true);
          }}
        />
      </AppShell>
    );
  }

  return (
    <AppShell screen="patient" encounter={encounter} connected={connected}>
      <PageHeader title="Where does it hurt?">Tap the body or point to where it hurts, then choose how much.</PageHeader>

      {draft && (
        <DraftCard draft={draft} busy={draftBusy} error={draftError} onSend={onSend} onRedo={onRedo} onEdit={onEdit} onHold={onHold} />
      )}
      {!draft && outcome && (
        <p className="outcome" role="status">
          {outcome}
        </p>
      )}

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
            mirrored
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
            <div className="panel confirm-card" role="status" aria-live="polite">
              <p className="eyebrow">The camera found</p>
              <p className="confirm-zone">{ZONE_LABELS[pointed.zone] ?? pointed.zone}</p>
              <p className="muted" style={{ margin: "0 0 14px" }}>
                Is that right? <strong>Nod twice</strong> for yes, <strong>shake your head</strong> to point again, or use the
                buttons.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary big" onClick={confirmPointed}>
                  Yes, that&apos;s it
                </button>
                <button className="btn big" onClick={cancelPointed}>
                  No, try again
                </button>
              </div>
            </div>
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
