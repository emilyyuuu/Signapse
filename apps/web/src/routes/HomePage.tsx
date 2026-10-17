import { useEffect, useState } from "react";
import type { Encounter } from "@synapse/shared";
import { createEncounter, listActiveEncounters } from "../lib/api";

const CLINICIAN_KEY = "synapse.clinicianId";

function savedClinician() {
  try {
    return localStorage.getItem(CLINICIAN_KEY) ?? "";
  } catch {
    return "";
  }
}

const since = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`;
};

// Start screen: the clinician starts a visit; a patient station joins an open one.
export function HomePage() {
  const [visits, setVisits] = useState<Encounter[]>();
  const [clinician, setClinician] = useState(savedClinician);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    listActiveEncounters()
      .then(setVisits)
      .catch((err) => setError(String(err.message ?? err)));
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const id = clinician.trim() || undefined;
      try {
        if (id) localStorage.setItem(CLINICIAN_KEY, id);
      } catch {
        /* storage unavailable; the visit still starts */
      }
      const e = await createEncounter(id);
      location.href = `/clinician?e=${e.encounterId}`;
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <h1 style={{ marginTop: 0 }}>Synapse</h1>
      <p className="muted">Sign-language translation for Deaf patients and clinical staff.</p>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Start a visit</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <label>
            <span className="muted" style={{ fontSize: 13, display: "block" }}>
              Clinician ID (optional)
            </span>
            <input
              className="input"
              value={clinician}
              onChange={(e) => setClinician(e.target.value)}
              placeholder="e.g. dr-lee"
              maxLength={64}
            />
          </label>
          <button className="btn primary" onClick={start} disabled={busy} style={{ alignSelf: "flex-end" }}>
            {busy ? "Starting…" : "Start new visit"}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          The patient gets a token like PT-7K3Q. No names are stored.
        </p>
      </section>

      <section className="panel">
        <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Open visits</h2>
        {error && <p className="chip urgent">{error}</p>}
        {!visits ? (
          <p className="muted">Loading…</p>
        ) : visits.length === 0 ? (
          <p className="muted">No open visits. Start one above.</p>
        ) : (
          <ul className="visits">
            {visits.map((v) => (
              <li key={v.encounterId}>
                <span>
                  <b>{v.patientRef}</b>{" "}
                  <span className="muted">
                    · {v.clinicianId} · started {since(v.startedAt)}
                  </span>
                </span>
                <span className="visit-links">
                  <a className="btn small" href={`/patient?e=${v.encounterId}`}>
                    Patient screen
                  </a>
                  <a className="btn small" href={`/clinician?e=${v.encounterId}`}>
                    Clinician
                  </a>
                  <a className="btn small" href={`/review?e=${v.encounterId}`}>
                    Review
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
