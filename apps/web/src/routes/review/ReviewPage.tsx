import { useCallback, useEffect, useState } from "react";
import { renderChartNote, type ChartNote, type ReviewData } from "@synapse/shared";
import { encounterIdFromUrl, getChartNote, getReview, verifyUtterance } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { UtteranceLine } from "../../components/conversation/UtteranceLine";
import { PainTrendChart } from "../../components/review/PainTrendChart";

const localTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function duration(fromIso: string, toIso: string) {
  const min = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

// Chart review: replay the visit from Tiger Data, confirm flagged lines, see the
// pain trend, and draft a chart note to copy or export.
export function ReviewPage() {
  const encounterId = encounterIdFromUrl();
  const [data, setData] = useState<ReviewData>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<ChartNote>();
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    getReview(encounterId)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((err) => setError(String(err)));
  }, [encounterId]);

  useEffect(load, [load]);
  // Stay current if the visit is still going or a line is confirmed elsewhere.
  useRoom(encounterId, load);

  const confirm = async (id: string) => {
    const row = await verifyUtterance(id, data?.encounter.clinicianId ?? "clinician");
    if (row) load();
    return !!row;
  };

  const generate = async () => {
    setNoteBusy(true);
    try {
      const n = await getChartNote(encounterId);
      setNote(n);
      setNoteText(renderChartNote(n, localTime));
    } catch (err) {
      setError(String(err));
    } finally {
      setNoteBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(noteText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (error && !data) return <main className="page">Could not load this encounter: {error}</main>;
  if (!data) return <main className="page muted">Loading…</main>;

  const { encounter, utterances, painTrend, stats } = data;
  const lastTs = utterances.at(-1)?.ts ?? encounter.startedAt;

  return (
    <main className="page">
      <h1 style={{ margin: "0 0 4px" }}>Chart review</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Patient <b>{encounter.patientRef}</b> · Clinician {encounter.clinicianId} · Started{" "}
        {localTime(encounter.startedAt)} · {duration(encounter.startedAt, encounter.endedAt ?? lastTs)} ·{" "}
        <a href={`/clinician?e=${encounterId}`}>Back to live screen</a>
      </p>

      <div className="stats" style={{ margin: "16px 0" }}>
        <div className="stat">
          <span className="muted">Lines</span>
          <b>{stats.lines}</b>
        </div>
        <div className={`stat${stats.urgent ? " alert" : ""}`}>
          <span className="muted">Urgent</span>
          <b>{stats.urgent}</b>
        </div>
        <div className={`stat${stats.unconfirmed ? " alert" : ""}`}>
          <span className="muted">Unconfirmed</span>
          <b>{stats.unconfirmed}</b>
        </div>
      </div>

      <div className="row">
        <section className="panel" style={{ flex: "1 1 420px" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Conversation</h2>
          {utterances.length === 0 ? (
            <p className="muted">Nothing recorded yet.</p>
          ) : (
            <ol className="lines">
              {utterances.map((u) => (
                <UtteranceLine key={u.id} u={u} onConfirm={confirm} />
              ))}
            </ol>
          )}
        </section>

        <div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className="panel">
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Pain over time</h2>
            <PainTrendChart trend={painTrend} />
          </section>

          <section className="panel">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 18, flex: "1 1 auto" }}>Chart note</h2>
              <button className="btn primary" onClick={generate} disabled={noteBusy}>
                {noteBusy ? "Drafting…" : note ? "Regenerate" : "Generate note"}
              </button>
              {note && (
                <button className="btn" onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
            </div>
            {note ? (
              <>
                {stats.unconfirmed > 0 && (
                  <p className="chip confirm" style={{ marginTop: 0 }}>
                    ⚠ {stats.unconfirmed} line{stats.unconfirmed > 1 ? "s" : ""} still unconfirmed. Confirm them, then
                    regenerate.
                  </p>
                )}
                <textarea
                  className="note"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  aria-label="Chart note"
                />
                <p className="muted" style={{ fontSize: 13 }}>
                  Edit the draft here if needed, then copy it into the hospital record.
                </p>
              </>
            ) : (
              <p className="muted">
                Builds a draft from the saved conversation and pain map. Facts come from the record; only the summary
                paragraph is AI-drafted.
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
