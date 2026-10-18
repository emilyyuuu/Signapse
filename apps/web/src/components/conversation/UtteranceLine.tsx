import { useState } from "react";
import {
  ZONE_LABELS,
  assessUtterance,
  describeFace,
  pointedZone,
  type GrammarFlag,
  type Speaker,
  type StoredUtterance,
} from "@signapse/shared";
import { Icon } from "../brand";

export const FLAG_LABEL: Record<GrammarFlag, string> = {
  statement: "Statement",
  question: "Question",
  negation: "Denial",
  intensified: "Emphasis",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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

// One conversation line as a chat bubble. The viewer's own lines are on the
// right (clinician screens by default; the patient's call screen passes
// self="patient"), the other side's on the left. Chips
// show urgency and grammar; a Confirm button shows while meaning is unconfirmed.
export function UtteranceLine({
  u,
  onConfirm,
  self = "clinician",
}: {
  u: StoredUtterance;
  onConfirm?: (id: string) => Promise<boolean>;
  self?: Speaker; // whose screen this is: their lines go on the right
}) {
  const { urgent, needsConfirm, confirmed } = assessUtterance(u);
  const face = faceSummary(u);
  const fromClinician = u.speaker === "clinician";
  const pointed = u.gloss ? pointedZone(u.gloss) : undefined;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const confirm = async () => {
    if (!onConfirm) return;
    setBusy(true);
    setFailed(!(await onConfirm(u.id)));
    setBusy(false);
  };

  return (
    <li className={`msg ${fromClinician ? "from-clinician" : "from-patient"} ${u.speaker === self ? "mine" : "theirs"}`}>
      {fromClinician ? (
        <span className="icon-btn avatar" aria-hidden="true">
          <Icon name="user" size={16} />
        </span>
      ) : (
        <span className="avatar patient-avatar" aria-hidden="true">
          <Icon name="hands" size={16} />
        </span>
      )}
      <div className={`bubble${urgent ? " urgent" : ""}`}>
        <div>{u.sentence}</div>
        <div className="meta">
          <small className="muted">{time(u.ts)}</small>
          {urgent && (
            <span className="chip urgent">
              <Icon name="alert" size={12} /> Urgent
            </span>
          )}
          {u.grammarFlag && <span className="chip flag">{FLAG_LABEL[u.grammarFlag]}</span>}
          {confirmed ? (
            <span className="chip ok">
              <Icon name="check" size={12} /> Confirmed by {u.verifiedBy}
              {u.verifiedAt ? `, ${time(u.verifiedAt)}` : ""}
            </span>
          ) : (
            needsConfirm && (
              <>
                <span className="chip confirm">Confirm meaning</span>
                {onConfirm && (
                  <button className="btn small" onClick={confirm} disabled={busy}>
                    {busy ? "Saving…" : "Confirm"}
                  </button>
                )}
                {failed && <span className="chip urgent">Not saved, try again</span>}
              </>
            )
          )}
          {pointed && (
            <span className="chip flag">
              <Icon name="body" size={12} /> Pointed: {ZONE_LABELS[pointed] ?? pointed}
            </span>
          )}
          {u.gloss && <span className="gloss">{u.gloss.join(" ")}</span>}
        </div>
        {face && <div className="face">Face: {face}</div>}
      </div>
    </li>
  );
}
