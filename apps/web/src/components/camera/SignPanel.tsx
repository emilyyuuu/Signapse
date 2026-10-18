import { useEffect, useRef, useState } from "react";
import { signText } from "@signapse/shared";
import { useSigning } from "./useSigning";

// Signing on the patient station. Built for someone who can't hear: large
// buttons, short sentences, and what the camera is doing is always written on
// screen (no sounds). With autoStart, signing turns on by itself and the only
// button is Done. What they sign is never sent straight to the doctor: the
// next steps ask where and how much, then "Is this right?".
export function SignPanel({ cameraOn, autoStart }: { cameraOn: boolean; autoStart?: boolean }) {
  const { status, act } = useSigning(cameraOn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState(false); // Done pressed: the next step is on its way
  const autoTried = useRef(false);

  const run = async (action: "start" | "done" | "cancel") => {
    setBusy(true);
    setError(undefined);
    const r = await act(action);
    if (!r.ok && action !== "cancel") setError(r.error);
    if (action === "done") setWaiting(r.ok);
    setBusy(false);
  };

  // Turn signing on once by itself.
  useEffect(() => {
    if (!autoStart || autoTried.current || !status?.available || status.state !== "off") return;
    autoTried.current = true;
    void run("start");
  }, [autoStart, status?.available, status?.state]);

  // An older camera program with no sign recognition: show nothing.
  if (!cameraOn || !status) return null;

  if (!status.available) {
    return (
      <div className="signing">
        <p className="signing-note">Sign reading is not available. {status.error}</p>
      </div>
    );
  }

  const open = status.state === "watching" || status.state === "signing";

  if (waiting && !open) {
    return (
      <div className="signing on" aria-live="polite">
        <p className="signing-state">Got it. One moment…</p>
      </div>
    );
  }

  return (
    <div className={`signing${open ? " on" : ""}`} aria-live="polite">
      {open ? (
        <>
          <p className="signing-state">
            {status.state === "signing" ? (
              <>
                <i className="rec" aria-hidden="true" /> Reading your sign…
              </>
            ) : (
              "Sign now. Put your hands down after each sign."
            )}
          </p>
          <p className="signing-words" aria-label="Signs read so far">
            {status.words.length ? (
              status.words.map((w, i) => (
                <span className="draft-tag plain" key={i}>
                  {w.gloss ? signText(w.gloss) : "…"}
                </span>
              ))
            ) : (
              <span className="muted">No signs yet.</span>
            )}
          </p>
          {status.note && <p className="signing-note">{status.note}</p>}
          <div className="draft-actions">
            <button className="btn huge primary" onClick={() => run("done")} disabled={busy || !status.words.length}>
              {busy ? "One moment…" : "Done"}
            </button>
            {!autoStart && (
              <button className="btn huge" onClick={() => run("cancel")} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {status.state === "thinking" && <p className="signing-state">Working out your sign…</p>}
          {(error || status.note) && <p className="signing-note">{error ?? status.note}</p>}
          <button className="btn huge primary signing-start" onClick={() => run("start")} disabled={busy}>
            Start signing
          </button>
        </>
      )}
    </div>
  );
}
