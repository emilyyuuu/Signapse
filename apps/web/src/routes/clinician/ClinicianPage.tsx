import { useEffect, useState } from "react";
import { assessUtterance, spokenParts, voiceTone, type Encounter, type StoredUtterance } from "@signapse/shared";
import { speak, speechSupported, unlockVoice } from "../../language/speak";
import { chime, unlockChime } from "../../language/chime";
import {
  createEncounter,
  encounterIdFromUrl,
  endEncounter,
  getEncounter,
  verifyUtterance,
} from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { AppShell } from "../../components/AppShell";
import { EmptyArt, Icon } from "../../components/brand";
import { PageHeader } from "../../components/PageHeader";
import { NameEditor } from "../../components/visit/NameEditor";
import { PainMapPanel } from "../../components/bodymap/PainMapPanel";
import { usePainMap } from "../../components/bodymap/usePainMap";
import { usePointing } from "../../components/bodymap/usePointing";
import { UtteranceLine, mergeLines } from "../../components/conversation/UtteranceLine";

// Clinician screen: each sentence with its facial grammar, an urgent banner
// with chime and voice, confirm buttons, and the patient's body map with where
// they are pointing, all live.
export function ClinicianPage() {
  const encounterId = encounterIdFromUrl();
  const [lines, setLines] = useState<StoredUtterance[]>([]);
  const [encounter, setEncounter] = useState<Encounter>();
  const [alert, setAlert] = useState<StoredUtterance | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const { pain, apply } = usePainMap(encounterId);
  const { pointed, handle: handlePoint } = usePointing();

  // Past sentences, so a refresh doesn't empty the log.
  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => {
        setEncounter(h.encounter);
        setLines((prev) => mergeLines(h.utterances, prev));
      })
      .catch((err) => console.warn(err));
  }, [encounterId]);

  const { connected } = useRoom(encounterId, (msg) => {
    handlePoint(msg);
    // Patient-screen and call messages. The server never sends drafts here; this guards against it anyway.
    if (
      msg.type === "point" ||
      msg.type === "gesture" ||
      msg.type === "signal" ||
      msg.type === "draft" ||
      msg.type === "draft_closed"
    )
      return;
    if (msg.type === "pain") {
      apply(msg.data);
      return;
    }
    if (msg.type === "ended" || msg.type === "encounter") {
      setEncounter(msg.data);
      return;
    }
    const u = msg.data;
    setLines((prev) => mergeLines(prev, [u]));
    if (msg.type === "verified") return; // an existing line was confirmed; no alert or voice
    const { urgent } = assessUtterance(u);
    if (urgent) setAlert(u);
    if (voiceOn && u.speaker === "patient") {
      const wait = urgent ? chime() : 0;
      setTimeout(() => speak(spokenParts(u)), wait);
    }
  });

  const confirm = async (id: string) => {
    const row = await verifyUtterance(id);
    if (row) setLines((prev) => mergeLines(prev, [row]));
    return !!row;
  };

  const newVisit = async () => {
    setBusy(true);
    try {
      const e = await createEncounter();
      location.href = `/clinician?e=${e.encounterId}`;
    } catch (err) {
      console.warn(err);
      setBusy(false);
    }
  };

  const endVisit = async () => {
    setBusy(true);
    try {
      setEncounter(await endEncounter(encounterId));
    } catch (err) {
      console.warn(err);
    } finally {
      setBusy(false);
    }
  };

  const latest = lines.at(-1);

  const actions = (
    <>
      {speechSupported && (
        <button
          className="icon-btn"
          aria-pressed={voiceOn}
          aria-label={voiceOn ? "Sound on. Click to mute" : "Enable sound"}
          title={voiceOn ? "Sound on" : "Enable sound"}
          onClick={() => {
            if (!voiceOn) {
              unlockVoice();
              unlockChime();
            }
            setVoiceOn(!voiceOn);
          }}
        >
          <Icon name={voiceOn ? "speaker" : "mute"} size={18} />
        </button>
      )}
      {encounter && !encounter.endedAt && (
        <button className="btn white" onClick={endVisit} disabled={busy}>
          End visit
        </button>
      )}
      <button className="btn dark" onClick={newVisit} disabled={busy}>
        New visit
      </button>
    </>
  );

  return (
    <AppShell screen="clinician" encounter={encounter} connected={connected} actions={actions}>
      {alert && (
        <div className="banner" role="alert">
          <span>URGENT: {alert.sentence}</span>
          <button className="btn" onClick={() => setAlert(null)}>
            Acknowledge
          </button>
        </div>
      )}

      {encounter?.endedAt && (
        <div className="ended" role="status">
          This visit ended at {new Date(encounter.endedAt).toLocaleTimeString()}. New signs and taps are no longer
          accepted. <a href={`/review?e=${encounterId}`}>Open the review and chart note</a>.
        </div>
      )}
      {!speechSupported && (
        <p className="muted">This browser has no built-in voice. Sentences are shown as text only.</p>
      )}

      <PageHeader greet={encounter ? `Visit ${encounter.patientRef}` : ""} title="Live translation">
        Signs and facial expressions from the patient station, as clinical sentences.
        {encounter && <NameEditor encounter={encounter} onChange={setEncounter} />}
      </PageHeader>

      <div className="row">
        <div style={{ flex: "1 1 460px", display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {latest ? (
            <section
              key={latest.id}
              className={`panel latest-card${assessUtterance(latest).urgent ? " urgent-card" : ""}`}
              aria-live="polite"
            >
              <div className="insight-head">
                <span className="orb">
                  <Icon name="chat" size={18} />
                </span>
                <div>
                  <h2>Latest translation</h2>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {new Date(latest.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {latest.gloss ? ` · signed ${latest.gloss.join(" ")}` : ""}
                  </span>
                </div>
              </div>
              <p className="latest">{latest.sentence}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn dark"
                  onClick={() => speak(spokenParts(latest))}
                  disabled={!speechSupported}
                >
                  <Icon name="speaker" size={17} />
                  Speak again
                </button>
                {latest.speaker === "patient" && (
                  <span className="chip tone" title="Voice tone, set from the patient's facial expression">
                    Tone: {voiceTone(latest).label}
                  </span>
                )}
                {assessUtterance(latest).unconfirmed && (
                  <button className="btn" onClick={() => confirm(latest.id)}>
                    <Icon name="check" size={17} />
                    Confirm meaning
                  </button>
                )}
              </div>
            </section>
          ) : (
            <section className="panel empty">
              <EmptyArt icon="hands" />
              <p style={{ fontSize: 16, margin: 0, color: "var(--ink)" }}>Waiting for the patient to sign…</p>
              <p style={{ margin: 0, fontSize: 13 }}>New sentences appear here and are read aloud.</p>
            </section>
          )}

          {lines.length > 0 && (
            <section className="panel chat-panel">
              <div className="section-head" style={{ marginTop: 0 }}>
                <h2 className="section-title">Conversation</h2>
                <span className="muted">{lines.length} {lines.length === 1 ? "line" : "lines"}</span>
              </div>
              <ol className="chat">
                {[...lines].reverse().map((u) => (
                  <UtteranceLine key={u.id} u={u} onConfirm={confirm} />
                ))}
              </ol>
            </section>
          )}
        </div>

        <PainMapPanel pain={pain} pointed={pointed} style={{ flex: "1 1 320px" }} />
      </div>
    </AppShell>
  );
}
