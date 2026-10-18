import { useEffect, useRef, useState } from "react";
import { API_URL, cameraStatus, startCamera, stopCamera } from "../../lib/api";
import { Icon } from "../brand";
import { SignPanel } from "./SignPanel";
import { CAMERA_URL } from "./useSigning";

export { CAMERA_URL };

// The pointing camera runs as a local Python program (apps/pointing). One click
// here asks the server on this computer to start it, then the page shows its
// picture. The picture is served from this computer only: the video never goes
// through the Signapse server. The same program reads signs (SignPanel).
const START_TIMEOUT_MS = 25_000;

export function CameraPanel({
  encounterId,
  lookingAt,
  hideFeed,
  onBeforeStart,
  autoStart,
  signing = true,
  pointHint = true,
}: {
  encounterId: string;
  lookingAt?: string;
  hideFeed?: boolean; // the call screen shows the picture itself
  onBeforeStart?: () => void; // e.g. free the webcam for the camera program
  autoStart?: boolean; // patient station: turn the camera and signing on without a click
  signing?: boolean; // false: the camera is only for pointing here (no signing box)
  pointHint?: boolean; // false: don't invite pointing (the patient is only signing here)
}) {
  const [on, setOn] = useState(false);
  const [checked, setChecked] = useState(false); // the first "is it on?" check has answered
  const autoTried = useRef(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState(false); // launcher unavailable: show the command instead
  const [copied, setCopied] = useState(false);
  const startedAt = useRef(0);
  // The camera was started by hand, so we can't tell which visit it reports to.
  const [unknownVisit, setUnknownVisit] = useState(false);

  // Is the camera picture available? Checked every couple of seconds.
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      try {
        const res = await fetch(`${CAMERA_URL}/status`, { signal: ctrl.signal });
        if (!stopped) setOn(res.ok);
      } catch {
        if (!stopped) setOn(false);
      } finally {
        clearTimeout(timer);
        if (!stopped) setChecked(true);
      }
      // Starting took too long: say what the program printed.
      if (!stopped && startedAt.current && Date.now() - startedAt.current > START_TIMEOUT_MS) {
        startedAt.current = 0;
        setStarting(false);
        const s = await cameraStatus();
        const last = s.data.log?.at(-1);
        setError(last ? `The camera didn't start: ${last}` : "The camera didn't start. Is another app using it?");
      }
    };
    void check();
    const id = setInterval(check, 1500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  // A camera left running for another visit (say the patient station) would send
  // this patient's pointing there. Move it to this visit.
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    void cameraStatus().then(async (s) => {
      if (cancelled || !s.ok) return;
      setUnknownVisit(!s.data.running);
      if (s.data.running && s.data.encounterId !== encounterId) {
        setStarting(true);
        const res = await startCamera(encounterId);
        if (!cancelled && !res.ok) {
          setStarting(false);
          setError(res.data.error ?? "The camera is reporting to another visit. Stop it and start it again.");
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [on, encounterId]);

  useEffect(() => {
    if (on) {
      startedAt.current = 0;
      setStarting(false);
      setError(undefined);
    }
  }, [on]);

  const start = async () => {
    onBeforeStart?.();
    setError(undefined);
    setStarting(true);
    startedAt.current = Date.now();
    const res = await startCamera(encounterId);
    if (!res.ok) {
      startedAt.current = 0;
      setStarting(false);
      if (res.status === 403) setManual(true);
      setError(res.data.error ?? "Couldn't start the camera.");
    }
  };

  // Patient station: start the camera once by itself. If that fails, the button and the reason show.
  useEffect(() => {
    if (!autoStart || !checked || on || starting || autoTried.current) return;
    autoTried.current = true;
    void start();
  }, [autoStart, checked, on, starting]);

  const stop = async () => {
    await stopCamera();
    setOn(false);
  };

  // One-time setup: the camera helper starts at login, after which this page turns the camera on by itself.
  const command = `.venv\\Scripts\\python -m pointing.launcher install --api ${API_URL} --origin ${location.origin}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; the command is shown to select by hand */
    }
  };

  return (
    <section className="panel camera" aria-label="Pointing camera">
      <div className="section-head" style={{ margin: "0 0 12px" }}>
        <h2 className="section-title">Camera</h2>
        <span className={`status ${on ? "live" : starting ? "connecting" : ""}`}>
          <i aria-hidden="true" />
          {on ? "On" : starting ? "Starting…" : "Off"}
        </span>
      </div>

      {on ? (
        <>
          {!hideFeed && <img className="camera-feed" src={`${CAMERA_URL}/video`} alt="Live camera with body tracking" />}
          {pointHint && (
            <p className="camera-reading" aria-live="polite">
              {lookingAt ? (
                <>
                  Pointing at <strong>{lookingAt}</strong>. Nod twice to confirm.
                </>
              ) : signing ? (
                "Point at where it hurts, or sign it."
              ) : (
                "Point at where it hurts."
              )}
            </p>
          )}
          {signing && <SignPanel cameraOn={on} autoStart={autoStart} />}
          <p className="camera-note">
            <Icon name="lock" size={14} />
            {hideFeed
              ? "On a call, video goes only to your doctor, encrypted. Frames sent to the server: 0."
              : "Video stays on this computer. Frames sent to the server: 0."}
          </p>
          {unknownVisit && (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
              This camera was started by hand. Pointing only reaches this visit if it was started with{" "}
              <code>SIGNAPSE_ENCOUNTER={encounterId}</code>.
            </p>
          )}
          <button className="btn small" onClick={stop}>
            Stop camera
          </button>
        </>
      ) : (
        <>
          <div className="camera-off">
            <Icon name="hands" size={26} />
            <p>
              {pointHint
                ? "Turn the camera on, then point at where it hurts. It finds the body part for you."
                : "Turn the camera on to sign how you feel."}
            </p>
            <button className="btn primary" onClick={start} disabled={starting}>
              {starting ? "Starting camera…" : "Start camera"}
            </button>
          </div>
          {error && (
            <p className="chip urgent" role="alert" style={{ marginTop: 10, whiteSpace: "normal" }}>
              {error}
            </p>
          )}
          {manual && (
            <>
              <p className="muted" style={{ margin: "12px 0 6px", fontSize: 13 }}>
                To turn the camera on from this page, set up the camera helper once. Run this in a Command
                Prompt in <code>apps\pointing</code>:
              </p>
              <pre className="camera-cmd">{command}</pre>
              <button className="btn small" onClick={copy}>
                {copied ? "Copied" : "Copy command"}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
