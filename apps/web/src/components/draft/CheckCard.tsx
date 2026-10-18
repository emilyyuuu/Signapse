import { useEffect, useState } from "react";
import type { DraftView } from "@signapse/shared";
import { Icon } from "../brand";

// Last step: "Is this right?" The patient reads their own words, then one of
// two big buttons. Nothing reaches the doctor until Send (an urgent one sends
// itself after a visible countdown). No sound anywhere: built for someone who
// can't hear.
export function CheckCard({
  draft,
  busy,
  error,
  onSend,
  onRestart,
}: {
  draft: DraftView;
  busy: boolean;
  error?: string;
  onSend: () => void;
  onRestart: () => void;
}) {
  const [left, setLeft] = useState<number | null>(null);

  // Seconds until an urgent message sends itself, counted against the server's clock.
  useEffect(() => {
    if (!draft.autoSendAt) {
      setLeft(null);
      return;
    }
    const offset = Date.parse(draft.now) - Date.now();
    const end = Date.parse(draft.autoSendAt);
    const tick = () => setLeft(Math.max(0, Math.ceil((end - (Date.now() + offset)) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [draft.autoSendAt, draft.now]);

  return (
    <section className="panel draft step" aria-label="Is this right?" aria-live="polite">
      <p className="eyebrow">Is this right?</p>
      <p className="draft-text">{draft.patientText}</p>
      {draft.grammarFlag !== "statement" && (
        <p className="draft-face">
          <Icon name="user" size={22} /> {draft.faceText}
        </p>
      )}

      {left !== null && (
        <div className="draft-timer" role="timer" aria-label={`Sending to the doctor in ${left} seconds`}>
          <p>
            <strong>This is urgent.</strong> It goes to the doctor in <strong>{left}</strong> seconds.
          </p>
          <div className="bar">
            <i style={{ width: `${(left / 10) * 100}%` }} />
          </div>
        </div>
      )}

      {error && (
        <p className="chip urgent" role="alert" style={{ whiteSpace: "normal", fontSize: 16 }}>
          {error}
        </p>
      )}

      <div className="draft-actions">
        <button className="btn primary huge" onClick={onSend} disabled={busy}>
          <Icon name="check" size={26} /> {busy ? "Sending…" : "Send to the doctor"}
        </button>
        <button className="btn huge" onClick={onRestart} disabled={busy}>
          Start again
        </button>
      </div>
    </section>
  );
}
