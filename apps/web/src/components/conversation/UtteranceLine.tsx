import { useState } from "react";
import { assessUtterance, describeFace, type GrammarFlag, type StoredUtterance } from "@synapse/shared";

export const FLAG_LABEL: Record<GrammarFlag, string> = {
  statement: "Statement",
  question: "Question",
  negation: "Denial",
  intensified: "Emphasis",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Merges two lists of lines by id (a confirmed copy replaces the original), oldest first.
export function mergeLines(a: StoredUtterance[], b: StoredUtterance[]) {
  const byId = new Map([...a, ...b].map((u) => [u.id, u]));
  return [...byId.values()].sort((x, y) => x.ts.localeCompare(y.ts));
}

export function faceSummary(u: StoredUtterance) {
  return u.grammarFlag && (u.nmm || u.grammarFlag !== "statement")
    ? describeFace(u.nmm, u.grammarFlag).summary
    : undefined;
}

// One conversation line: sentence, chips, raw signs, what the face showed, and
// a Confirm button while the meaning is unconfirmed.
export function UtteranceLine({
  u,
  onConfirm,
}: {
  u: StoredUtterance;
  onConfirm?: (id: string) => Promise<boolean>;
}) {
  const { urgent, needsConfirm, confirmed } = assessUtterance(u);
  const face = faceSummary(u);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const confirm = async () => {
    if (!onConfirm) return;
    setBusy(true);
    setFailed(!(await onConfirm(u.id)));
    setBusy(false);
  };

  return (
    <li className={`line${urgent ? " urgent" : ""}`}>
      <div>{u.sentence}</div>
      <div className="meta">
        <small className="muted">{time(u.ts)}</small>
        {u.speaker === "clinician" && <span className="chip">Clinician</span>}
        {urgent && <span className="chip urgent">Urgent</span>}
        {u.grammarFlag && <span className="chip flag">{FLAG_LABEL[u.grammarFlag]}</span>}
        {confirmed ? (
          <span className="chip ok">
            ✓ Confirmed by {u.verifiedBy}
            {u.verifiedAt ? `, ${time(u.verifiedAt)}` : ""}
          </span>
        ) : (
          needsConfirm && (
            <>
              <span className="chip confirm">⚠ Confirm meaning</span>
              {onConfirm && (
                <button className="btn small" onClick={confirm} disabled={busy}>
                  {busy ? "Saving…" : "Confirm"}
                </button>
              )}
              {failed && <span className="chip urgent">Not saved, try again</span>}
            </>
          )
        )}
        {u.gloss && <span className="gloss">{u.gloss.join(" ")}</span>}
      </div>
      {face && <div className="face">Face: {face}</div>}
    </li>
  );
}
