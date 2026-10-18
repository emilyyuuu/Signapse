import { useEffect, useState } from "react";
import {
  MEANING_CHOICES,
  PATIENT_VOCAB,
  meaningShort,
  signText,
  type DraftView,
  type GrammarFlag,
} from "@signapse/shared";
import { Icon } from "../brand";

// "Check what you signed": the patient reads their own interpretation before it
// goes anywhere. Built for someone who cannot hear: no sound, large text, large
// touch targets, high contrast, short sentences, and a visible countdown instead
// of a beep. Nothing reaches the doctor until Send (urgent ones send themselves).
interface Props {
  draft: DraftView;
  busy: boolean;
  error?: string;
  onSend: () => void;
  onRedo: () => void;
  onEdit: (change: { gloss?: string[]; grammarFlag?: GrammarFlag }) => void;
  onHold: () => void;
}

// A sign can be swapped for another word, but pointing and number signs are re-done by pointing again.
const swappable = (token: string) => PATIENT_VOCAB.some((v) => v.token === token);

export function DraftCard({ draft, busy, error, onSend, onRedo, onEdit, onHold }: Props) {
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState<number | "add" | null>(null); // which sign is being changed
  const [left, setLeft] = useState<number | null>(null);

  // Seconds until an urgent draft sends itself, counted against the server's clock.
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

  // While they edit, an urgent draft must not send itself half-fixed.
  useEffect(() => {
    if (!editing || !draft.urgent) return;
    const id = setInterval(onHold, 4000);
    return () => clearInterval(id);
  }, [editing, draft.urgent, onHold]);

  const total = 10;
  const swap = (index: number, token: string) => {
    const gloss = [...draft.gloss];
    gloss[index] = token;
    onEdit({ gloss });
    setPicking(null);
  };
  const add = (token: string) => {
    onEdit({ gloss: [...draft.gloss, token] });
    setPicking(null);
  };
  const remove = (index: number) => onEdit({ gloss: draft.gloss.filter((_, i) => i !== index) });

  return (
    <section className="panel draft" aria-label="Check what you signed" aria-live="polite">
      <p className="eyebrow">Check what you signed</p>
      <p className="draft-text">{draft.patientText}</p>
      <p className="draft-face">
        <Icon name="user" size={22} /> {draft.faceText}
      </p>
      <p className="draft-tags">
        <span className="draft-tag">{meaningShort(draft.grammarFlag)}</span>
        {draft.gloss.map((g, i) => (
          <span className="draft-tag plain" key={`${g}-${i}`}>
            {signText(g)}
          </span>
        ))}
        {draft.edited && <span className="draft-tag plain">You changed this</span>}
      </p>

      {left !== null && (
        <div className="draft-timer" role="timer" aria-label={`Sending to the doctor in ${left} seconds`}>
          <p>
            <strong>This is urgent.</strong> It will go to the doctor in <strong>{left}</strong> seconds. Press Edit or Redo to change
            it.
          </p>
          <div className="bar">
            <i style={{ width: `${(left / total) * 100}%` }} />
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
          <Icon name="check" size={26} /> {busy ? "Sending…" : "Send"}
        </button>
        <button className="btn huge" onClick={onRedo} disabled={busy}>
          Redo
        </button>
        <button className="btn huge" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      <p className="draft-help">Send = tell the doctor. Redo = sign again. Edit = fix it.</p>

      {editing && (
        <div className="draft-edit">
          <h2>What did you mean?</h2>
          <div className="draft-choices">
            {MEANING_CHOICES.map((m) => (
              <button
                key={m.flag}
                className="choice"
                aria-pressed={draft.grammarFlag === m.flag}
                onClick={() => onEdit({ grammarFlag: m.flag })}
              >
                {m.text}
              </button>
            ))}
          </div>

          <h2>Your signs</h2>
          <ul className="draft-signlist">
            {draft.gloss.map((g, i) => (
              <li key={`${g}-${i}`}>
                <span className="draft-signname">{signText(g)}</span>
                {swappable(g) && (
                  <button className="btn" onClick={() => setPicking(picking === i ? null : i)}>
                    Change
                  </button>
                )}
                {draft.gloss.length > 1 && (
                  <button className="btn" onClick={() => remove(i)} aria-label={`Remove ${signText(g)}`}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button className="btn" onClick={() => setPicking(picking === "add" ? null : "add")}>
            Add a sign
          </button>

          {picking !== null && (
            <div className="draft-choices words" role="group" aria-label="Choose a word">
              {PATIENT_VOCAB.map((v) => (
                <button key={v.token} className="choice" onClick={() => (picking === "add" ? add(v.token) : swap(picking, v.token))}>
                  {v.text}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
