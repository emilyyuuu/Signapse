import { useEffect, useState } from "react";
import { DEMO_ENCOUNTER_ID } from "@signapse/shared";
import { listActiveEncounters } from "../../lib/api";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { CameraPanel } from "../../components/camera/CameraPanel";
import { cancelRecording, rebuildModel, startRecording, useRecording } from "../../components/camera/useRecording";

const NAME = /^[a-z][a-z-]{1,23}$/;

// Staff page: record more examples of each sign, then rebuild the recorded-sign
// model. Examples are hand points only, saved on this computer
// (apps/recognition-python/recorder/recordings). The rebuild backs up the
// current model first and loads the new one into the running camera.
export function RecordPage() {
  const [encounterId, setEncounterId] = useState<string>();
  const { status, signs } = useRecording();
  const [sign, setSign] = useState("pain");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string>();

  // The camera program runs for a visit: use the one in the URL, else the newest open one.
  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get("e");
    if (fromUrl) return setEncounterId(fromUrl);
    listActiveEncounters()
      .then((v) => setEncounterId(v[0]?.encounterId ?? DEMO_ENCOUNTER_ID))
      .catch(() => setEncounterId(DEMO_ENCOUNTER_ID));
  }, []);

  const counts = status?.counts ?? {};
  const all = [...new Set([...signs, ...Object.keys(counts)])].sort();
  const busy = status?.state === "waiting" || status?.state === "recording";
  const rebuild = status?.rebuild;

  const record = async () => {
    setError(undefined);
    const r = await startRecording(sign);
    if (!r.ok) setError(r.error);
  };
  const addSign = () => {
    const name = newName.trim().toLowerCase();
    if (!NAME.test(name)) return setError("Use 2 to 24 lowercase letters, e.g. dizzy.");
    setSign(name);
    setNewName("");
    setError(undefined);
  };

  return (
    <AppShell screen="record">
      <PageHeader greet="Staff" title="Record signs">
        Record more examples so the camera reads signs better. Sign once per recording: hands down, sign, hands down. Aim
        for 5–10 examples per sign, from 2–3 people.
      </PageHeader>

      <div className="row">
        <div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {encounterId && <CameraPanel encounterId={encounterId} autoStart signing={false} />}
        </div>

        <div style={{ flex: "1 1 360px", display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <section className="panel">
            <h2 className="section-title">1. Choose a sign</h2>
            <div className="rec-signs">
              {[...new Set([...all, sign])].map((s) => (
                <button key={s} className="choice" aria-pressed={sign === s} onClick={() => setSign(s)} disabled={busy}>
                  {s} <span className="rec-count">{counts[s] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="rec-new">
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New sign, e.g. dizzy"
                aria-label="New sign name"
                onKeyDown={(e) => e.key === "Enter" && addSign()}
              />
              <button className="btn" onClick={addSign} disabled={busy}>
                Add
              </button>
            </div>
          </section>

          <section className="panel">
            <h2 className="section-title">2. Record</h2>
            {!status ? (
              <p className="muted">Waiting for the camera…</p>
            ) : busy ? (
              <>
                <p className="rec-state">
                  {status.state === "recording" ? (
                    <>
                      <i className="rec" aria-hidden="true" /> Recording {status.sign}… put your hands down when done.
                    </>
                  ) : (
                    <>Put your hands up and sign “{status.sign}”.</>
                  )}
                </p>
                <button className="btn" onClick={() => void cancelRecording()}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="btn primary huge" onClick={record} disabled={rebuild?.state === "running"}>
                  Record “{sign}”
                </button>
                {status.note && <p className="rec-note">{status.note}</p>}
              </>
            )}
            {error && (
              <p className="chip urgent" role="alert" style={{ whiteSpace: "normal" }}>
                {error}
              </p>
            )}
          </section>

          <section className="panel">
            <h2 className="section-title">3. Rebuild the model</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Uses every example on this computer. The current model is backed up first, and the camera uses the new one
              straight away.
            </p>
            <button className="btn dark" onClick={() => void rebuildModel()} disabled={busy || rebuild?.state === "running"}>
              {rebuild?.state === "running" ? "Rebuilding…" : "Rebuild model"}
            </button>
            {rebuild?.state === "failed" && (
              <p className="chip urgent" role="alert" style={{ whiteSpace: "normal" }}>
                Rebuild failed: {rebuild.error}. The old model is unchanged{rebuild.backup ? ` (backup ${rebuild.backup})` : ""}.
              </p>
            )}
            {rebuild?.state === "done" && (
              <div className="rec-result">
                <p>
                  <strong>
                    {rebuild.correct} of {rebuild.examples}
                  </strong>{" "}
                  examples recognised when each is checked against the others. Backup: {rebuild.backup}.
                </p>
                <table className="rec-table">
                  <tbody>
                    {Object.entries(rebuild.perSign ?? {}).map(([s, r]) => (
                      <tr key={s}>
                        <td>{s}</td>
                        <td>
                          {r.correct} / {r.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rebuild.mixedUp && Object.keys(rebuild.mixedUp).length > 0 && (
                  <p className="muted">
                    Mixed up:{" "}
                    {Object.entries(rebuild.mixedUp)
                      .map(([k, n]) => `${k.replace(" -> ", " read as ")} (${n})`)
                      .join(", ")}
                    . Record more of these.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
