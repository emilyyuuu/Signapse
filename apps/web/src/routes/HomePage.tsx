import { useEffect, useState } from "react";
import type { Encounter } from "@signapse/shared";
import { createEncounter, endEncounter, listActiveEncounters } from "../lib/api";
import { AppShell } from "../components/AppShell";
import { EmptyArt, HeroArt, Icon } from "../components/brand";

const CLINICIAN_KEY = "signapse.clinicianId";
const SAMPLE_VISIT = "00000000-0000-4000-8000-000000000002";

function savedClinician() {
  try {
    return localStorage.getItem(CLINICIAN_KEY) ?? "";
  } catch {
    return "";
  }
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
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
  // Ending a visit takes two clicks: End, then End visit.
  const [confirmEnd, setConfirmEnd] = useState<string>();

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

  // Call mode: a new visit held as a video call with a doctor somewhere else.
  const startCall = async () => {
    setBusy(true);
    try {
      const e = await createEncounter(clinician.trim() || undefined);
      location.href = `/call?e=${e.encounterId}`;
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setBusy(false);
    }
  };

  const end = async (id: string) => {
    try {
      await endEncounter(id);
      setVisits((prev) => prev?.filter((v) => v.encounterId !== id));
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setConfirmEnd(undefined);
    }
  };

  const firstOpen = visits?.[0];

  return (
    <AppShell screen="visits">
      <div className="home-top">
        <HeroArt />
        <div style={{ width: "100%" }}>
          <p className="greet">{greeting()}{clinician.trim() ? `, ${clinician.trim()}` : ""}</p>
          <h1 className="page-title">Ready to start a visit?</h1>
          <p className="lede">
            Sign language and facial expressions, translated into clear clinical sentences for the care team.
          </p>
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <Icon name="user" size={18} />
            <input
              value={clinician}
              onChange={(e) => setClinician(e.target.value)}
              placeholder="Clinician ID (optional)"
              aria-label="Clinician ID (optional)"
              maxLength={64}
            />
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Starting…" : "Start visit"}
              <Icon name="arrow" size={16} />
            </button>
          </form>
          <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>
            Patients get a token like PT-7K3Q. No names are stored.
          </p>
        </div>
      </div>

      {firstOpen && (
        <a className="banner-pill" href={`/clinician?e=${firstOpen.encounterId}`}>
          <span className="circle">
            <Icon name="list" size={20} />
          </span>
          <span>
            You have <b>{visits!.length} open {visits!.length === 1 ? "visit" : "visits"}</b>. Continue with{" "}
            <b>{firstOpen.patientRef}</b>
          </span>
          <span className="arrow">
            <Icon name="arrow" size={22} />
          </span>
        </a>
      )}

      <div className="section-head">
        <h2 className="section-title">Quick access</h2>
      </div>
      <div className="quick">
        <a href={`/review?e=${SAMPLE_VISIT}`}>
          <span className="quick-top">
            <span className="circle tint-blue">
              <Icon name="clipboard" />
            </span>
            <span className="go">
              <Icon name="upright" size={16} />
            </span>
          </span>
          <span>
            <b>Sample chart review</b>
            <small>A finished 40-minute visit</small>
          </span>
        </a>
        <a href={firstOpen ? `/patient?e=${firstOpen.encounterId}` : "#start"} onClick={(e) => !firstOpen && e.preventDefault()}>
          <span className="quick-top">
            <span className="circle tint-green">
              <Icon name="hands" />
            </span>
            <span className="go">
              <Icon name="upright" size={16} />
            </span>
          </span>
          <span>
            <b>Patient station</b>
            <small>{firstOpen ? `Join ${firstOpen.patientRef}` : "Start a visit first"}</small>
          </span>
        </a>
        <a href={firstOpen ? `/clinician?e=${firstOpen.encounterId}` : "#start"} onClick={(e) => !firstOpen && e.preventDefault()}>
          <span className="quick-top">
            <span className="circle tint-lilac">
              <Icon name="chat" />
            </span>
            <span className="go">
              <Icon name="upright" size={16} />
            </span>
          </span>
          <span>
            <b>Live translation</b>
            <small>{firstOpen ? `Open ${firstOpen.patientRef}` : "Start a visit first"}</small>
          </span>
        </a>
        <a
          href="/call"
          onClick={(e) => {
            e.preventDefault();
            if (!busy) void startCall();
          }}
        >
          <span className="quick-top">
            <span className="circle tint-blue">
              <Icon name="phone" />
            </span>
            <span className="go">
              <Icon name="upright" size={16} />
            </span>
          </span>
          <span>
            <b>Call a doctor</b>
            <small>Video call with live captions</small>
          </span>
        </a>
      </div>

      <div className="section-head">
        <h2 className="section-title">Open visits</h2>
        {visits && visits.length > 0 && <span className="muted">{visits.length} open</span>}
      </div>
      {error && <p className="chip urgent">{error}</p>}
      {!visits ? (
        <p className="muted">Loading…</p>
      ) : visits.length === 0 ? (
        <div className="panel empty">
          <EmptyArt icon="calendar" />
          <p style={{ margin: 0 }}>No open visits. Start one above.</p>
        </div>
      ) : (
        <ul className="visits">
          {visits.map((v) => (
            <li key={v.encounterId} className="visit">
              <div className="visit-top">
                <span className="chip live">Open</span>
                <span className="visit-end">
                  {confirmEnd === v.encounterId ? (
                    <>
                      <button className="btn small danger" onClick={() => end(v.encounterId)}>
                        End visit
                      </button>
                      <button className="btn small quiet" onClick={() => setConfirmEnd(undefined)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn small quiet"
                      onClick={() => setConfirmEnd(v.encounterId)}
                      aria-label={`End visit ${v.patientRef}`}
                    >
                      End
                    </button>
                  )}
                </span>
              </div>
              <b>{v.patientRef}</b>
              <div>
                <div className="meta-line">
                  <Icon name="user" size={15} /> {v.clinicianId}
                </div>
                <div className="meta-line">
                  <Icon name="clock" size={15} /> Started {since(v.startedAt)}
                </div>
              </div>
              <div className="visit-actions">
                <a className="btn primary" href={`/clinician?e=${v.encounterId}`}>
                  Open visit
                </a>
                <a className="btn" href={`/patient?e=${v.encounterId}`}>
                  Patient screen
                </a>
                <a className="icon-btn" href={`/review?e=${v.encounterId}`} aria-label={`Review ${v.patientRef}`}>
                  <Icon name="clipboard" size={18} />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
