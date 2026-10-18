import { useState } from "react";
import { NAME_MAX, cleanName } from "@signapse/shared";
import { Icon } from "../brand";

// Check-in on the patient station: the patient types their name. Large type, large
// buttons, short sentences, no sound. The name is shown to the care team and kept
// only on the visit record. Skipping is allowed; staff can add a name later.
export function CheckIn({
  onSubmit,
  onSkip,
}: {
  onSubmit: (name: string) => Promise<string | undefined>; // returns an error message, or undefined on success
  onSkip: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const clean = cleanName(name);
    if (!clean) {
      setError("Please type your name using letters. You can use spaces, hyphens and apostrophes.");
      return;
    }
    setBusy(true);
    setError(undefined);
    const problem = await onSubmit(clean);
    if (problem) setError(problem);
    setBusy(false);
  };

  return (
    <section className="panel checkin" aria-label="Check in">
      <p className="eyebrow">Welcome</p>
      <h1 className="checkin-title">What is your name?</h1>
      <p className="checkin-help">Type your name. The care team will see it.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="checkin-label" htmlFor="patient-name">
          Your name
        </label>
        <input
          id="patient-name"
          className="checkin-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
          maxLength={NAME_MAX}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          inputMode="text"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "name-error" : undefined}
        />
        {error && (
          <p id="name-error" className="chip urgent" role="alert" style={{ whiteSpace: "normal", fontSize: 18, marginTop: 12 }}>
            {error}
          </p>
        )}
        <div className="draft-actions" style={{ marginTop: 22 }}>
          <button className="btn primary huge" type="submit" disabled={busy || !name.trim()}>
            <Icon name="check" size={26} /> {busy ? "Saving…" : "Continue"}
          </button>
          <button className="btn huge" type="button" onClick={onSkip} disabled={busy}>
            Skip for now
          </button>
        </div>
      </form>
    </section>
  );
}
