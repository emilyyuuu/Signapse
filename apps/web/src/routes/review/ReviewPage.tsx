import { useCallback, useEffect, useState } from "react";
import { renderChartNote, type ChartNote, type ReviewData } from "@signapse/shared";
import { encounterIdFromUrl, getChartNote, getReview, verifyUtterance } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { AppShell } from "../../components/AppShell";
import { EmptyArt, Icon } from "../../components/brand";
import { PageHeader } from "../../components/PageHeader";
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
  // Live-only traffic (pointing, gestures, call setup) changes nothing stored.
  const { connected } = useRoom(encounterId, (msg) => {
    if (msg.type === "utterance" || msg.type === "verified" || msg.type === "pain" || msg.type === "ended") load();
  });

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

  if (!data) {
    return (
      <AppShell screen="review">
        <p className={error ? undefined : "muted"}>{error ? `Could not load this visit: ${error}` : "Loading…"}</p>
      </AppShell>
    );
  }

  const { encounter, utterances, painTrend, stats } = data;
  const lastTs = utterances.at(-1)?.ts ?? encounter.startedAt;

  return (
    <AppShell screen="review" encounter={encounter} connected={connected}>
      <PageHeader greet={`Visit ${encounter.patientRef}`} title="Chart review">
        Clinician {encounter.clinicianId} · Started {localTime(encounter.startedAt)} ·{" "}
        {duration(encounter.startedAt, encounter.endedAt ?? lastTs)}
      </PageHeader>

      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="stat-head">
            <span className="circle tint-blue">
              <Icon name="chat" size={17} />
            </span>
            Lines translated
          </div>
          <b>{stats.lines}</b>
        </div>
        <div className={`stat${stats.urgent ? " alert" : ""}`}>
          <div className="stat-head">
            <span className={`circle ${stats.urgent ? "tint-red" : "tint-green"}`}>
              <Icon name="alert" size={17} />
            </span>
            Urgent flags
          </div>
          <b>{stats.urgent}</b>
        </div>
        <div className="stat">
          <div className="stat-head">
            <span className={`circle ${stats.unconfirmed ? "tint-amber" : "tint-green"}`}>
              <Icon name="check" size={17} />
            </span>
            {stats.unconfirmed ? "Need confirmation" : "All confirmed"}
          </div>
          <b>{stats.unconfirmed}</b>
        </div>
      </div>

      <div className="row">
        <section className="panel chat-panel" style={{ flex: "1 1 420px" }}>
          <div className="section-head" style={{ marginTop: 0 }}>
            <h2 className="section-title">Conversation</h2>
            <span className="muted">{utterances.length} {utterances.length === 1 ? "line" : "lines"}</span>
          </div>
          {utterances.length === 0 ? (
            <div className="empty">
              <EmptyArt icon="clipboard" />
              <p>Nothing recorded yet.</p>
            </div>
          ) : (
            <ol className="chat">
              {utterances.map((u) => (
                <UtteranceLine key={u.id} u={u} onConfirm={confirm} />
              ))}
            </ol>
          )}
        </section>

        <div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className="panel">
            <h2 className="section-title">Pain over time</h2>
            <PainTrendChart trend={painTrend} />
          </section>

          <section className="panel">
            <div className="insight-head">
              <span className="orb">
                <Icon name="clipboard" size={18} />
              </span>
              <div>
                <h2>Chart note</h2>
                <span className="muted" style={{ fontSize: 13 }}>
                  Built from the saved record. Only the summary is AI-drafted.
                </span>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
              <button className="btn dark" onClick={generate} disabled={noteBusy}>
                {noteBusy ? "Drafting…" : note ? "Regenerate" : "Generate note"}
              </button>
              {note && (
                <button className="btn" onClick={copy}>
                  {copied ? "Copied" : "Copy to record"}
                </button>
              )}
            </div>
            {note ? (
              <>
                {stats.unconfirmed > 0 && (
                  <p className="chip confirm" style={{ marginTop: 0 }}>
                    {stats.unconfirmed} line{stats.unconfirmed > 1 ? "s" : ""} still unconfirmed. Confirm them, then
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
            ) : null}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
