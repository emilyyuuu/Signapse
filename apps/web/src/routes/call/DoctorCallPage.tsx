import { useEffect, useRef, useState, type FormEvent } from "react";
import { assessUtterance, spokenParts, type Encounter, type StoredUtterance } from "@signapse/shared";
import { encounterIdFromUrl, getEncounter, postUtterance, verifyUtterance } from "../../lib/api";
import { useCall } from "../../lib/useCall";
import { speak, speechSupported, unlockVoice } from "../../language/speak";
import { chime, unlockChime } from "../../language/chime";
import { createListener, listenSupported, prepareOnDevice, type Listener } from "../../language/listen";
import { AppShell } from "../../components/AppShell";
import { EmptyArt, Icon } from "../../components/brand";
import { CallStage, CallStatus } from "../../components/call/CallVideo";
import { FLAG_LABEL, UtteranceLine, mergeLines } from "../../components/conversation/UtteranceLine";
import { PainMapPanel } from "../../components/bodymap/PainMapPanel";
import { usePainMap } from "../../components/bodymap/usePainMap";
import { usePointing } from "../../components/bodymap/usePointing";

// Doctor side of a call, opened from the link the patient sent. The patient's
// signs arrive as sentences, shown over their video and read aloud. The
// doctor's speech is captioned live for the patient. Like the clinician screen,
// it has the urgent banner, confirm buttons and the live pain map.
export function DoctorCallPage() {
  const encounterId = encounterIdFromUrl();
  const [encounter, setEncounter] = useState<Encounter>();
  const [media, setMedia] = useState<MediaStream>();
  const [onDevice, setOnDevice] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => setEncounter(h.encounter))
      .catch(() => setError("This call link isn't valid, or the server can't be reached."));
  }, [encounterId]);

  // One click unlocks camera, microphone, voice and captions, and only then
  // does the patient see the doctor waiting.
  const join = async () => {
    setJoining(true);
    setError(undefined);
    unlockVoice();
    unlockChime();
    try {
      const [stream, local] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: true, noiseSuppression: true } }),
        prepareOnDevice(),
      ]);
      setOnDevice(local);
      setMedia(stream);
    } catch {
      setError("Allow the camera and microphone for this site to join the call.");
      setJoining(false);
    }
  };

  useEffect(() => () => media?.getTracks().forEach((t) => t.stop()), [media]);

  if (encounter?.endedAt) {
    return (
      <AppShell screen="call" encounter={encounter}>
        <section className="panel empty" style={{ maxWidth: 560, margin: "40px auto", padding: "40px 24px" }}>
          <EmptyArt icon="phone" />
          <h1 className="page-title">This call has ended</h1>
          <p style={{ margin: 0 }}>The conversation and pain readings were saved with the visit.</p>
          <a className="btn primary" href={`/review?e=${encounterId}`}>
            Open the review and chart note
          </a>
        </section>
      </AppShell>
    );
  }

  if (!media) {
    return (
      <AppShell screen="call" encounter={encounter}>
        <section className="panel" style={{ maxWidth: 620, margin: "40px auto", padding: "32px 28px" }}>
          <p className="eyebrow">Signapse call</p>
          <h1 className="page-title">A Deaf patient is calling you</h1>
          <p>
            The patient signs; you see them and hear their signs as speech. Speak normally: your words appear on their
            screen as captions. The call is encrypted between your browser and theirs.
          </p>
          {!listenSupported && (
            <p className="callout">
              This browser can&apos;t caption speech. Use Chrome or Edge, or type your replies during the call.
            </p>
          )}
          <button className="btn primary big" onClick={join} disabled={joining || !encounter}>
            <Icon name="phone" size={18} />
            {joining ? "Joining…" : "Join call"}
          </button>
          {error && (
            <p className="chip urgent" role="alert" style={{ marginTop: 12, whiteSpace: "normal" }}>
              {error}
            </p>
          )}
        </section>
      </AppShell>
    );
  }

  return <DoctorCall encounterId={encounterId} encounter={encounter} media={media} onDevice={onDevice} onEnded={setEncounter} />;
}

function DoctorCall({
  encounterId,
  encounter,
  media,
  onDevice,
  onEnded,
}: {
  encounterId: string;
  encounter?: Encounter;
  media: MediaStream;
  onDevice: boolean;
  onEnded: (e: Encounter) => void;
}) {
  const [lines, setLines] = useState<StoredUtterance[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [mine, setMine] = useState(""); // what the patient is seeing as you speak
  const [captionError, setCaptionError] = useState<string>();
  const [typed, setTyped] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const [alert, setAlert] = useState<StoredUtterance | null>(null);
  const [voiceOn, setVoiceOnState] = useState(true); // unlocked by the Join click
  const voiceOnRef = useRef(true);
  const setVoiceOn = (on: boolean) => {
    voiceOnRef.current = on;
    setVoiceOnState(on);
    if (!on && speechSupported) speechSynthesis.cancel();
  };
  const { pain, apply } = usePainMap(encounterId);
  const { pointed, handle: handlePoint } = usePointing();
  const listener = useRef<Listener | null>(null);
  const sendCaption = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => setLines((prev) => mergeLines(h.utterances, prev)))
      .catch((err) => console.warn(err));
  }, [encounterId]);

  const reply = async (sentence: string) => {
    const row = await postUtterance({ encounterId, speaker: "clinician", kind: "reply", sentence });
    if (row) setLines((prev) => mergeLines(prev, [row]));
    setSendFailed(!row);
    return !!row;
  };

  // Reads a patient sentence aloud, without captioning it as the doctor's words.
  const readAloud = (u: StoredUtterance) => {
    listener.current?.pause();
    const wait = assessUtterance(u).urgent ? chime() : 0;
    setTimeout(() => speak(spokenParts(u), { onEnd: () => listener.current?.resume() }), wait);
  };

  const call = useCall({
    encounterId,
    role: "doctor",
    video: media.getVideoTracks()[0],
    audio: micOn ? media.getAudioTracks()[0] : undefined,
    onMessage: (msg) => {
      handlePoint(msg);
      if (msg.type === "pain") apply(msg.data);
      if (msg.type === "ended") onEnded(msg.data);
      if (msg.type !== "utterance" && msg.type !== "verified") return;
      setLines((prev) => mergeLines(prev, [msg.data]));
      if (msg.type === "verified" || msg.data.speaker !== "patient") return;
      if (assessUtterance(msg.data).urgent) setAlert(msg.data);
      if (voiceOnRef.current) readAloud(msg.data);
    },
  });
  sendCaption.current = call.sendCaption;

  // Live captions of the doctor's speech while the microphone is on.
  useEffect(() => {
    const l = createListener({
      onDevice,
      onInterim: (text) => {
        setMine(text);
        sendCaption.current(text);
      },
      onFinal: (text) => {
        setMine("");
        sendCaption.current("");
        void reply(text.charAt(0).toUpperCase() + text.slice(1));
      },
      onError: (e) =>
        setCaptionError(
          e === "not-allowed" || e === "service-not-allowed"
            ? "Captions are blocked. Allow the microphone, or type your replies."
            : `Captions paused (${e}). They restart on their own.`,
        ),
    });
    listener.current = l;
    return () => {
      l?.stop();
      listener.current = null;
    };
  }, [onDevice]);

  useEffect(() => {
    if (micOn && call.state === "connected") listener.current?.start();
    else listener.current?.stop();
  }, [micOn, call.state]);

  const sendTyped = async (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (text && (await reply(text))) setTyped("");
  };

  const confirm = async (id: string) => {
    const row = await verifyUtterance(id);
    if (row) setLines((prev) => mergeLines(prev, [row]));
    return !!row;
  };

  const latest = [...lines].reverse().find((u) => u.speaker === "patient");
  const latestInfo = latest && assessUtterance(latest);

  if (call.state === "ended") {
    return (
      <AppShell screen="call" encounter={encounter}>
        <section className="panel empty" style={{ maxWidth: 560, margin: "40px auto", padding: "40px 24px" }}>
          <EmptyArt icon="phone" />
          <h1 className="page-title">The call has ended</h1>
          <p style={{ margin: 0 }}>The conversation and pain readings were saved with the visit.</p>
          <a className="btn primary" href={`/review?e=${encounterId}`}>
            Open the review and chart note
          </a>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell screen="call" encounter={encounter} connected={call.connected}>
      {alert && (
        <div className="banner" role="alert">
          <span>URGENT: {alert.sentence}</span>
          <button className="btn" onClick={() => setAlert(null)}>
            Acknowledge
          </button>
        </div>
      )}

      <div className="call-layout">
        <div className="call-main">
          <CallStage
            remote={call.remoteStream}
            self={media}
            remoteLabel="The patient"
            placeholder={
              <>
                <Icon name="hands" size={34} />
                <p>
                  {call.state === "knocking"
                    ? "Waiting for the patient to let you in…"
                    : call.state === "waiting"
                      ? "Waiting for the patient…"
                      : "Connecting…"}
                </p>
              </>
            }
          >
            {latest && (
              <div className={`caption-sign${latestInfo?.urgent ? " urgent" : ""}`} key={latest.id}>
                <p className="caption-text">{latest.sentence}</p>
                <div className="meta">
                  {latestInfo?.urgent && (
                    <span className="chip urgent">
                      <Icon name="alert" size={12} /> Urgent
                    </span>
                  )}
                  {latest.grammarFlag && <span className="chip flag">{FLAG_LABEL[latest.grammarFlag]}</span>}
                  {latestInfo?.unconfirmed && <span className="chip confirm">Confirm meaning</span>}
                  {latest.gloss && <span className="gloss">{latest.gloss.join(" ")}</span>}
                  {!latest.gloss && <span className="chip">Typed</span>}
                </div>
              </div>
            )}
          </CallStage>

          <div className="call-controls">
            <CallStatus state={call.state} safetyCode={call.safetyCode} />
            <div className="call-buttons">
              {latest && latestInfo?.unconfirmed && (
                <button className="btn" onClick={() => confirm(latest.id)}>
                  <Icon name="check" size={16} /> Confirm meaning
                </button>
              )}
              {latest && speechSupported && (
                <button className="btn" onClick={() => readAloud(latest)} title="Read the latest sentence again">
                  <Icon name="speaker" size={16} /> Repeat
                </button>
              )}
              {speechSupported && (
                <button
                  className="icon-btn"
                  aria-pressed={voiceOn}
                  aria-label={voiceOn ? "Reading aloud. Click to mute" : "Read the patient's sentences aloud"}
                  title={voiceOn ? "Reading sentences aloud" : "Not reading aloud"}
                  onClick={() => setVoiceOn(!voiceOn)}
                >
                  <Icon name={voiceOn ? "speaker" : "mute"} size={18} />
                </button>
              )}
              <button
                className="icon-btn"
                aria-pressed={micOn}
                aria-label={micOn ? "Microphone and captions on. Click to mute" : "Unmute microphone"}
                title={micOn ? "Microphone and captions on" : "Muted"}
                onClick={() => setMicOn(!micOn)}
              >
                <Icon name={micOn ? "mic" : "micOff"} size={18} />
              </button>
              <button className="btn danger" onClick={call.hangUp}>
                <Icon name="phone" size={16} />
                Leave call
              </button>
            </div>
          </div>

          <section className="panel call-reply" aria-live="polite">
            <p className="eyebrow" style={{ margin: "0 0 4px" }}>
              The patient sees{onDevice ? " · captions made on this device" : ""}
            </p>
            <p className="caption-mine">
              {mine || (
                <span className="muted">{micOn ? "Speak, and your words appear here and on their screen." : "Muted."}</span>
              )}
            </p>
            {captionError && <p className="muted call-fine">{captionError}</p>}
            {!onDevice && listenSupported && (
              <p className="muted call-fine">
                <Icon name="alert" size={13} /> Captions use the browser&apos;s online speech service, so your voice is sent to
                it. Avoid names and other identifiers, or type instead.
              </p>
            )}
            {!speechSupported && <p className="muted call-fine">This browser has no built-in voice; sentences are text only.</p>}
            <form className="field" onSubmit={sendTyped}>
              <Icon name="chat" size={18} />
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                maxLength={500}
                placeholder="Or type a reply. End with ? for YES/NO buttons"
                aria-label="Type a reply to the patient"
              />
              <button className="btn primary" type="submit" disabled={!typed.trim()}>
                Send
              </button>
            </form>
            {sendFailed && (
              <p className="chip urgent" role="alert" style={{ marginTop: 10 }}>
                Not sent. Check the connection and try again.
              </p>
            )}
          </section>
        </div>

        <aside className="call-side" aria-label={`Visit ${encounter?.patientRef ?? ""}`}>
          <PainMapPanel pain={pain} pointed={pointed} />
          <section className="panel chat-panel call-chat">
            <div className="section-head" style={{ margin: "0 0 12px" }}>
              <h2 className="section-title">Conversation</h2>
              <span className="muted">{lines.length} {lines.length === 1 ? "line" : "lines"}</span>
            </div>
            {lines.length ? (
              <ol className="chat">
                {[...lines].reverse().map((u) => (
                  <UtteranceLine key={u.id} u={u} onConfirm={confirm} />
                ))}
              </ol>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Nothing said yet.
              </p>
            )}
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
