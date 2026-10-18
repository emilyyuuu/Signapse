import { useEffect, useRef, useState, type FormEvent } from "react";
import { ZONE_LABELS, type Encounter, type StoredUtterance } from "@signapse/shared";
import { encounterIdFromUrl, endEncounter, getEncounter, postUtterance } from "../../lib/api";
import { useCall } from "../../lib/useCall";
import { usePatientVideo } from "../../lib/usePatientVideo";
import { AppShell } from "../../components/AppShell";
import { EmptyArt, Icon } from "../../components/brand";
import { CameraPanel } from "../../components/camera/CameraPanel";
import { CallStage, CallStatus } from "../../components/call/CallVideo";
import { UtteranceLine, mergeLines } from "../../components/conversation/UtteranceLine";
import { BodyMap } from "../../components/bodymap/BodyMap";
import { PainList } from "../../components/bodymap/PainList";
import { PointConfirm } from "../../components/bodymap/PointConfirm";
import { SeverityPicker } from "../../components/bodymap/SeverityPicker";
import { usePainFlow } from "../../components/bodymap/usePainFlow";

// Patient side of a call. The patient signs to the camera; the doctor sees the
// video and the translated sentences. What the doctor says appears here as
// large live captions, with YES/NO buttons when they ask a question.
export function PatientCallPage() {
  const encounterId = encounterIdFromUrl();
  const [encounter, setEncounter] = useState<Encounter>();
  const [lines, setLines] = useState<StoredUtterance[]>([]);
  const [live, setLive] = useState(""); // what the doctor is saying right now
  const [soundOn, setSoundOn] = useState(true); // for patients with some hearing
  const [mic, setMic] = useState<MediaStreamTrack>();
  const [typed, setTyped] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const video = usePatientVideo();
  // Pointing at where it hurts works as at the patient station; the doctor sees it on their pain map.
  const flow = usePainFlow(encounterId);
  // Sidebar tab. Starts on Camera so the patient can switch sign reading on,
  // moves to the conversation once it is on, and to Pain when they point.
  const [tab, setTab] = useState<"pain" | "chat" | "camera">("camera");
  const leftCameraTab = useRef(false);
  useEffect(() => {
    if (video.source === "preview" && !leftCameraTab.current) {
      leftCameraTab.current = true;
      setTab("chat");
    }
  }, [video.source]);
  const pointedAt = flow.pointed?.at;
  useEffect(() => {
    if (pointedAt) setTab("pain");
  }, [pointedAt]);

  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => {
        setEncounter(h.encounter);
        setLines((prev) => mergeLines(h.utterances, prev));
      })
      .catch((err) => console.warn(err));
  }, [encounterId]);

  const call = useCall({
    encounterId,
    role: "patient",
    video: video.stream?.getVideoTracks()[0],
    audio: mic,
    onCaption: setLive,
    onMessage: (msg) => {
      flow.handle(msg);
      if (msg.type === "ended") setEncounter(msg.data);
      if (msg.type !== "utterance" && msg.type !== "verified") return;
      setLines((prev) => mergeLines(prev, [msg.data]));
      if (msg.data.speaker === "clinician") setLive("");
    },
  });

  // Stop the microphone when leaving the page.
  useEffect(() => () => mic?.stop(), [mic]);

  const toggleMic = async () => {
    if (mic) {
      mic.stop();
      setMic(undefined);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      setMic(s.getAudioTracks()[0]);
    } catch {
      setSendFailed(true);
    }
  };

  const say = async (sentence: string, kind: "sign" | "answer") => {
    const row = await postUtterance({ encounterId, speaker: "patient", kind, sentence });
    if (row) setLines((prev) => mergeLines(prev, [row]));
    setSendFailed(!row);
    return !!row;
  };

  const sendTyped = async (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (text && (await say(text, "sign"))) setTyped("");
  };

  const hangUp = async () => {
    call.hangUp();
    mic?.stop();
    try {
      setEncounter(await endEncounter(encounterId));
    } catch (err) {
      console.warn(err);
    }
  };

  const doctorLink = `${location.origin}/call/doctor?e=${encounterId}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(doctorLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; the link is shown to select by hand */
    }
  };

  // The doctor's newest line, and whether it is a question still waiting for an answer.
  const lastDoctor = [...lines].reverse().find((u) => u.speaker === "clinician");
  const answered = lastDoctor && lines.some((u) => u.speaker === "patient" && u.ts > lastDoctor.ts);
  const question = lastDoctor && !answered && lastDoctor.sentence.trim().endsWith("?") ? lastDoctor : undefined;

  if (encounter?.endedAt || call.state === "ended") {
    return (
      <AppShell screen="call" encounter={encounter}>
        <section className="panel empty" style={{ maxWidth: 560, margin: "40px auto", padding: "40px 24px" }}>
          <EmptyArt icon="phone" />
          <h1 className="page-title">The call has ended</h1>
          <p style={{ fontSize: 19, margin: 0, color: "var(--ink)" }}>
            Thank you. The conversation was saved for your doctor&apos;s notes.
          </p>
          <a className="btn primary" href="/">
            Back to start
          </a>
        </section>
      </AppShell>
    );
  }

  const inCall = call.state === "connecting" || call.state === "connected";
  const cameraOn = video.source === "preview";

  return (
    <AppShell screen="call" encounter={encounter} connected={call.connected}>
      <div className="call-layout">
        <div className="call-main">
          {call.state === "knocking" && (
            <div className="panel confirm-card call-notice" role="alert">
              <div>
                <p className="eyebrow">Someone is waiting</p>
                <p className="call-notice-title">A doctor wants to join your call</p>
                <p className="muted" style={{ margin: 0 }}>
                  Only let them in if you sent them the link. They will see your camera.
                </p>
              </div>
              <button className="btn primary big" onClick={call.admit}>
                Let them in
              </button>
            </div>
          )}

          {call.state === "waiting" && (
            <section className="panel pop pop-blue call-notice">
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <h1 className="call-notice-title">Call your doctor</h1>
                <p className="muted" style={{ margin: "0 0 12px" }}>
                  Send them this link by text or email. They open it in Chrome or Edge, and you let them in.
                </p>
                <div className="field">
                  <Icon name="phone" size={18} />
                  <input readOnly value={doctorLink} onFocus={(e) => e.target.select()} aria-label="Link for your doctor" />
                  <button className="btn primary" onClick={copyLink}>
                    <Icon name="copy" size={16} />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </section>
          )}

          <CallStage
            remote={call.remoteStream}
            self={video.stream}
            remoteMuted={!soundOn}
            remoteLabel="Your doctor"
            placeholder={
              <>
                <Icon name="user" size={34} />
                <p>{inCall ? "Connecting to your doctor…" : "Your doctor will appear here."}</p>
              </>
            }
          >
            {(live || lastDoctor) && (
              <p className={`caption-text${live ? " live" : ""}`} aria-live="polite">
                {live || lastDoctor?.sentence}
              </p>
            )}
          </CallStage>

          <div className="call-controls">
            <CallStatus state={call.state} safetyCode={call.safetyCode} />
            <div className="call-buttons">
              <button
                className="icon-btn"
                aria-pressed={!!mic}
                aria-label={mic ? "Microphone on. Click to turn off" : "Turn on microphone"}
                title={mic ? "Microphone on" : "Microphone off"}
                onClick={toggleMic}
              >
                <Icon name={mic ? "mic" : "micOff"} size={18} />
              </button>
              <button
                className="icon-btn"
                aria-pressed={soundOn}
                aria-label={soundOn ? "Doctor's sound on. Click to mute" : "Turn on doctor's sound"}
                title={soundOn ? "Doctor's sound on" : "Doctor's sound off"}
                onClick={() => setSoundOn(!soundOn)}
              >
                <Icon name={soundOn ? "speaker" : "mute"} size={18} />
              </button>
              <button className="btn danger" onClick={hangUp}>
                <Icon name="phone" size={16} />
                Hang up
              </button>
            </div>
          </div>

          {question && (
            <div className="panel answer-card" role="group" aria-label="Answer the doctor's question">
              <p className="eyebrow">Your doctor asked</p>
              <p className="call-notice-title">{question.sentence}</p>
              <div className="answer-buttons">
                <button className="btn primary big" onClick={() => say("Yes.", "answer")}>
                  <Icon name="check" size={20} /> YES
                </button>
                <button className="btn dark big" onClick={() => say("No.", "answer")}>
                  NO
                </button>
              </div>
            </div>
          )}

          {flow.pointed && !flow.selected && (
            <PointConfirm zone={flow.pointed.zone} onYes={flow.confirmPointed} onNo={flow.cancelPointed} />
          )}
          {flow.selected && (
            <>
              {flow.fromPointing && (
                <p className="callout" role="status" style={{ margin: 0 }}>
                  You {flow.pointed?.gesture === "touch" ? "touched" : "pointed to"} your{" "}
                  {ZONE_LABELS[flow.selected].toLowerCase()}. Choose how much it hurts, or tap the correct place.
                </p>
              )}
              <SeverityPicker zone={flow.selected} value={flow.pain[flow.selected] ?? 0} onPick={flow.pick} />
            </>
          )}
          {flow.signed && !flow.selected && (
            <p className="callout" role="status" style={{ margin: 0 }}>
              We understood <strong>{flow.signed.level} out of 10</strong> for your{" "}
              {ZONE_LABELS[flow.signed.zone].toLowerCase()} from your signing. If that is wrong, tap the place again.
            </p>
          )}
          {flow.sendFailed && (
            <p className="chip urgent" role="alert">
              Pain level not sent. Check the connection and tap again.
            </p>
          )}

          <form className="field" onSubmit={sendTyped}>
            <Icon name="chat" size={18} />
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={500}
              placeholder="Or type a message to your doctor"
              aria-label="Type a message to your doctor"
            />
            <button className="btn primary" type="submit" disabled={!typed.trim()}>
              Send
            </button>
          </form>
          {sendFailed && (
            <p className="chip urgent" role="alert">
              Not sent. Check the connection and try again.
            </p>
          )}
        </div>

        <aside className="call-side" aria-label="Pain, conversation and camera">
          <div className="seg call-tabs" role="tablist">
            <button role="tab" aria-pressed={tab === "pain"} aria-selected={tab === "pain"} onClick={() => setTab("pain")}>
              Pain
            </button>
            <button role="tab" aria-pressed={tab === "chat"} aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
              Conversation{lines.length > 0 && <span className="tab-count">{lines.length}</span>}
            </button>
            <button
              role="tab"
              aria-pressed={tab === "camera"}
              aria-selected={tab === "camera"}
              onClick={() => setTab("camera")}
            >
              <i className={`tab-dot${cameraOn ? " on" : ""}`} aria-hidden="true" />
              Camera
            </button>
          </div>

          <div className="call-side-body">
            {tab === "pain" && (
              <section className="panel pop pop-blue" aria-label="Where does it hurt">
                <div className="section-head" style={{ margin: "0 0 12px" }}>
                  <h2 className="section-title">Where does it hurt?</h2>
                </div>
                <div className="seg seg-small" style={{ marginBottom: 12 }}>
                  {(["front", "back", "face"] as const).map((v) => (
                    <button key={v} aria-pressed={flow.view === v} onClick={() => flow.setView(v)}>
                      {v === "front" ? "Front" : v === "back" ? "Back" : "Face"}
                    </button>
                  ))}
                </div>
                <div className="call-bodymap">
                  <BodyMap
                    view={flow.view}
                    pain={flow.pain}
                    selected={flow.selected}
                    highlighted={flow.pointed?.zone}
                    tentative={flow.pointed?.gesture === "touch"}
                    onPick={flow.tap}
                    mirrored
                  />
                </div>
                <p className="muted" style={{ fontSize: 13, textAlign: "center", margin: "8px 0 12px" }}>
                  Tap or point to where it hurts. Your doctor sees it.
                </p>
                <div className="painlist-card">
                  <PainList pain={flow.pain} />
                </div>
              </section>
            )}

            {tab === "chat" && (
              <section className="panel chat-panel">
                {lines.length ? (
                  <ol className="chat">
                    {[...lines].reverse().map((u) => (
                      <UtteranceLine key={u.id} u={u} self="patient" />
                    ))}
                  </ol>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    Nothing said yet. What you sign and what your doctor says will show here.
                  </p>
                )}
              </section>
            )}

            {/* Kept mounted so the camera status keeps updating in the tab dot. */}
            <div style={{ display: tab === "camera" ? "flex" : "none", flexDirection: "column", gap: 14 }}>
              <CameraPanel
                encounterId={encounterId}
                hideFeed
                onBeforeStart={video.releaseWebcam}
                lookingAt={flow.pointed && !flow.selected ? ZONE_LABELS[flow.pointed.zone] : undefined}
              />
              {video.source === "none" && (
                <div className="panel">
                  <p className="muted" style={{ marginTop: 0 }}>
                    Can&apos;t start sign reading? You can still show your doctor your camera and type instead.
                  </p>
                  <button className="btn" onClick={video.useWebcam}>
                    Video only
                  </button>
                  {video.webcamError && (
                    <p className="chip urgent" role="alert" style={{ marginTop: 10, whiteSpace: "normal" }}>
                      {video.webcamError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
