import { useEffect, useRef, useState } from "react";
import {
  PATIENT_VOCAB,
  complaintOf,
  pointGloss,
  pointedZone,
  signedLevel,
  type DraftView,
  type Encounter,
  type PatientAction,
} from "@signapse/shared";
import { checkIn, editDraft, encounterIdFromUrl, getEncounter, holdDraft, redoDraft, sendDraft, tapClause } from "../../lib/api";
import { useRoom } from "../../lib/useRoom";
import { AppShell } from "../../components/AppShell";
import { EmptyArt } from "../../components/brand";
import { CameraPanel } from "../../components/camera/CameraPanel";
import { CheckCard } from "../../components/draft/CheckCard";
import { RateStep } from "../../components/draft/RateStep";
import { WhereStep } from "../../components/draft/WhereStep";
import { CheckIn } from "../../components/visit/CheckIn";

const OUTCOME_TEXT: Record<PatientAction, string> = {
  sent: "Sent to the doctor.",
  edited: "Sent to the doctor.",
  auto_sent: "This was urgent, so it was sent to the doctor.",
  redone: "OK. Sign it again.",
};

// What the patient can tap if signing doesn't work for them.
const TAP_WORDS = [
  "PAIN",
  "HEADACHE",
  "NAUSEA",
  "VOMIT",
  "FEVER",
  "CHILLS",
  "COUGH",
  "BREATHE",
  "DIZZY",
  "FAINT",
  "TIRED",
  "WEAK",
  "NUMB",
  "RASH",
  "ITCH",
  "SWELLING",
  "BLEEDING",
  "DIARRHEA",
  "ALLERGY",
  "ANXIOUS",
  "HEARTATTACK",
];
const PAIN_SIGNS = ["PAIN", "HEADACHE"];

// Which question to show for what they signed: where (pain with no place yet),
// how much (pain with no number yet), then "Is this right?".
function stepFor(gloss: string[]): "where" | "rate" | "check" {
  if (!gloss.some((g) => PAIN_SIGNS.includes(g))) return "check"; // e.g. nausea, fever: nothing to place
  if (!pointedZone(gloss) && !complaintOf(gloss).zone) return "where";
  if (signedLevel(gloss) === undefined) return "rate";
  return "check";
}

// Patient station, one question at a time:
//   1. Sign how you feel (camera and signing turn on by themselves)
//   2. Where does it hurt? (tap the body or point)
//   3. How much does it hurt? (0-10)
//   then "Is this right?": Send to the doctor, or Start again.
export function PatientPage() {
  const encounterId = encounterIdFromUrl();
  const [encounter, setEncounter] = useState<Encounter>();
  // What they signed, waiting for the next answer or for them to check it.
  const [draft, setDraft] = useState<DraftView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<string>();
  const [pointedAt, setPointedAt] = useState<string>();
  // Check-in: the patient types their name first. Skipping is remembered for this tab.
  const skipKey = `signapse.skipCheckin.${encounterId}`;
  const [skipped, setSkipped] = useState(() => {
    try {
      return sessionStorage.getItem(skipKey) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    getEncounter(encounterId)
      .then((h) => setEncounter(h.encounter))
      .catch((err) => console.warn(err));
  }, [encounterId]);

  const step = draft ? stepFor(draft.gloss) : "sign";
  const stepRef = useRef(step);
  stepRef.current = step;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(undefined);
    const res = await fn();
    if (!res.ok) setError(res.error);
    setBusy(false);
  };
  // Add an answer (a place or a number) to what they signed.
  const answer = (token: string, replacePrefix: string) => {
    if (!draft) return;
    const gloss = [...draft.gloss.filter((g) => !g.startsWith(replacePrefix)), token];
    void run(() => editDraft(encounterId, draft.id, { gloss }));
  };
  const pickPlace = (zone: string) => answer(pointGloss(zone), "POINT-");

  const { connected } = useRoom(
    encounterId,
    (msg) => {
      if (msg.type === "ended" || msg.type === "encounter") setEncounter(msg.data);
      if (msg.type === "draft") {
        setDraft(msg.data);
        setError(undefined);
        setOutcome(undefined);
        setPointedAt(undefined);
      }
      if (msg.type === "draft_closed") {
        setDraft((d) => (d && d.id === msg.data.id ? undefined : d));
        setBusy(false);
        setOutcome(OUTCOME_TEXT[msg.data.action]);
      }
      // "Where does it hurt?" can be answered by pointing at it with the camera.
      if (msg.type === "point" && stepRef.current === "where") {
        setPointedAt(msg.data.zone);
        pickPlace(msg.data.zone);
      }
    },
    { role: "patient" },
  );

  // While they answer where and how much, an urgent message must not send itself half-done.
  useEffect(() => {
    if (!draft?.urgent || (step !== "where" && step !== "rate")) return;
    const hold = () => void holdDraft(encounterId, draft.id);
    hold();
    const id = setInterval(hold, 4000);
    return () => clearInterval(id);
  }, [draft?.id, draft?.urgent, step, encounterId]);

  // "Sent" shows for a moment, then the screen is ready for the next thing.
  useEffect(() => {
    if (!outcome) return;
    const id = setTimeout(() => setOutcome(undefined), 6000);
    return () => clearTimeout(id);
  }, [outcome]);

  if (encounter?.endedAt) {
    return (
      <AppShell screen="patient" encounter={encounter}>
        <section className="panel empty" style={{ maxWidth: 560, margin: "40px auto", padding: "40px 24px" }}>
          <EmptyArt icon="chat" />
          <h1 className="page-title">This visit has ended</h1>
          <p style={{ fontSize: 19, margin: 0, color: "var(--ink)" }}>Thank you. A staff member will be with you.</p>
        </section>
      </AppShell>
    );
  }

  if (encounter && !encounter.patientName && !skipped) {
    return (
      <AppShell screen="patient" encounter={encounter} connected={connected}>
        <CheckIn
          onSubmit={async (name) => {
            const res = await checkIn(encounterId, name);
            if (res.ok && res.encounter) setEncounter(res.encounter);
            return res.ok ? undefined : res.error;
          }}
          onSkip={() => {
            try {
              sessionStorage.setItem(skipKey, "1");
            } catch {
              /* storage unavailable: skipping lasts until reload */
            }
            setSkipped(true);
          }}
        />
      </AppShell>
    );
  }

  return (
    <AppShell screen="patient" encounter={encounter} connected={connected}>
      {outcome && (
        <p className="outcome" role="status">
          {outcome}
        </p>
      )}

      {step === "sign" && (
        <div className="steps">
          <section className="panel step">
            <p className="eyebrow">Step 1 of 3</p>
            <h1 className="step-title">Sign how you feel.</h1>
            <p className="step-help">Put your hands down after each sign. Press Done when you finish.</p>
            <CameraPanel encounterId={encounterId} autoStart pointHint={false} />
          </section>
          <section className="panel step tap-words" aria-label="Or tap how you feel">
            <h2>Or tap how you feel</h2>
            <div className="draft-choices words">
              {TAP_WORDS.map((t) => (
                <button key={t} className="choice" disabled={busy} onClick={() => run(() => tapClause(encounterId, [t]))}>
                  {PATIENT_VOCAB.find((v) => v.token === t)?.text ?? t}
                </button>
              ))}
            </div>
            {error && (
              <p className="chip urgent" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}

      {draft && step === "where" && (
        <div className="steps">
          <p className="step-said">{draft.patientText}</p>
          <WhereStep highlighted={pointedAt} onPick={pickPlace} />
          <CameraPanel encounterId={encounterId} signing={false} />
        </div>
      )}

      {draft && step === "rate" && (
        <div className="steps">
          <p className="step-said">{draft.patientText}</p>
          <RateStep zone={pointedZone(draft.gloss) ?? complaintOf(draft.gloss).zone} onPick={(n) => answer(`NUM-${n}`, "NUM-")} />
        </div>
      )}

      {draft && step === "check" && (
        <div className="steps">
          <CheckCard
            draft={draft}
            busy={busy}
            error={error}
            onSend={() => run(() => sendDraft(encounterId, draft.id))}
            onRestart={() => run(() => redoDraft(encounterId, draft.id))}
          />
        </div>
      )}
    </AppShell>
  );
}
