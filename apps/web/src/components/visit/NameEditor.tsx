import { useState } from "react";
import type { Encounter } from "@signapse/shared";
import { checkIn } from "../../lib/api";

// Shows the patient's name on staff screens, and lets staff add or fix it
// (for a patient who skipped check-in, or a typo).
export function NameEditor({ encounter, onChange }: { encounter: Encounter; onChange: (e: Encounter) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    setBusy(true);
    setError(undefined);
    const res = await checkIn(encounter.encounterId, value);
    setBusy(false);
    if (res.ok && res.encounter) {
      onChange(res.encounter);
      setEditing(false);
    } else {
      setError(res.error);
    }
  };

  if (!editing) {
    return (
      <p className="name-row">
        <span className="muted">Patient</span>{" "}
        {encounter.patientName ? (
          <strong>{encounter.patientName}</strong>
        ) : (
          <span className="muted">waiting for check-in</span>
        )}
        {!encounter.endedAt && (
          <button
            className="btn small"
            onClick={() => {
              setValue(encounter.patientName ?? "");
              setEditing(true);
            }}
          >
            {encounter.patientName ? "Edit name" : "Add name"}
          </button>
        )}
      </p>
    );
  }

  return (
    <form
      className="name-row"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="muted" htmlFor="staff-name">
        Patient name
      </label>
      <input
        id="staff-name"
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={60}
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      <button className="btn small primary" type="submit" disabled={busy || !value.trim()}>
        Save
      </button>
      <button className="btn small" type="button" onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && (
        <span className="chip urgent" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
