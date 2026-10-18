import { ZONE_LABELS } from "./bodyZones";
import { assessUtterance, complaintOf } from "./language";
import type { ChartNote, Encounter, NoteItem, StoredPainReading, StoredUtterance } from "./types";

// Chart note for one encounter, built only from stored data. Nothing here is
// written by a language model; the optional aiSummary is added separately and
// labelled as AI-drafted.

function item(u: StoredUtterance): NoteItem {
  const a = assessUtterance(u);
  return {
    id: u.id,
    ts: u.ts,
    text: u.sentence,
    gloss: u.gloss,
    confirmed: a.confirmed,
    needsConfirm: a.needsConfirm,
    verifiedBy: u.verifiedBy,
  };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildChartNote(
  encounter: Encounter,
  utterances: StoredUtterance[],
  pain: StoredPainReading[],
): ChartNote {
  const lines = [...utterances].sort((a, b) => a.ts.localeCompare(b.ts));
  const signed = lines.filter((u) => u.speaker === "patient" && u.kind === "sign");
  const reportedLines = signed.filter((u) => u.grammarFlag === "statement" || u.grammarFlag === "intensified");

  // Chief complaint: the first urgent report, otherwise the first report.
  const chief = [...reportedLines.filter((u) => assessUtterance(u).urgent), ...reportedLines]
    .map((u) => complaintOf(u.gloss ?? []).complaint)
    .find(Boolean);

  const byZone = new Map<string, StoredPainReading[]>();
  for (const p of [...pain].sort((a, b) => a.ts.localeCompare(b.ts))) {
    byZone.set(p.zone, [...(byZone.get(p.zone) ?? []), p]);
  }
  const painSummary = [...byZone.entries()]
    .map(([zone, readings]) => {
      const first = readings[0].severity;
      const latest = readings[readings.length - 1].severity;
      return {
        zone,
        label: ZONE_LABELS[zone] ?? zone,
        peak: Math.max(...readings.map((r) => r.severity)),
        latest,
        trend: (latest > first ? "rising" : latest < first ? "falling" : "steady") as ChartNote["pain"][number]["trend"],
      };
    })
    .filter((z) => z.peak > 0)
    .sort((a, b) => b.peak - a.peak);

  return {
    encounter: {
      encounterId: encounter.encounterId,
      patientRef: encounter.patientRef,
      clinicianId: encounter.clinicianId,
      startedAt: encounter.startedAt,
      endedAt: encounter.endedAt,
    },
    generatedAt: new Date().toISOString(),
    chiefComplaint: chief ? capitalise(chief.replace(/^a /, "")) : undefined,
    reported: reportedLines.map(item),
    denied: signed.filter((u) => u.grammarFlag === "negation").map(item),
    patientQuestions: signed.filter((u) => u.grammarFlag === "question").map(item),
    clinicianReplies: lines.filter((u) => u.speaker === "clinician").map(item),
    patientAnswers: lines.filter((u) => u.speaker === "patient" && u.kind === "answer").map(item),
    pain: painSummary,
    urgentFlags: signed.filter((u) => assessUtterance(u).urgent).map(item),
    unconfirmedCount: lines.filter((u) => assessUtterance(u).unconfirmed).length,
  };
}

// Visit log for the AI summary: relative times, no names, unconfirmed lines marked.
export function visitLog(note: ChartNote): string {
  const start = Date.parse(note.encounter.startedAt);
  const t = (ts: string) => `+${Math.max(0, Math.round((Date.parse(ts) - start) / 60_000))} min`;
  const mark = (i: NoteItem) => (i.needsConfirm && !i.confirmed ? " [UNCONFIRMED]" : "");
  const section = (title: string, items: NoteItem[]) =>
    items.map((i) => `${t(i.ts)} ${title}: ${i.text}${mark(i)}`);
  return [
    ...section("Patient reported", note.reported),
    ...section("Patient denied", note.denied),
    ...section("Patient asked", note.patientQuestions),
    ...section("Clinician said", note.clinicianReplies),
    ...section("Patient answered", note.patientAnswers),
    ...note.pain.map((p) => `Pain map: ${p.label} peak ${p.peak}/10, latest ${p.latest}/10, ${p.trend}`),
  ].join("\n");
}

// Plain-text note to paste into an EHR. formatTime lets the browser show local time.
export function renderChartNote(note: ChartNote, formatTime: (iso: string) => string): string {
  const out: string[] = [];
  const e = note.encounter;
  out.push("CLINICAL ENCOUNTER NOTE (DRAFT)");
  out.push(`Patient: ${e.patientRef}   Clinician: ${e.clinicianId}   Started: ${formatTime(e.startedAt)}`);
  out.push("Source: Signapse sign-language translation (ASL). Not a substitute for a qualified interpreter.");

  if (note.aiSummary) {
    out.push("", "SUMMARY (AI-drafted, verify before signing)", note.aiSummary);
  }
  out.push("", `CHIEF COMPLAINT: ${note.chiefComplaint ?? "Not recorded"}`);

  const line = (i: NoteItem) => {
    const status = i.confirmed
      ? `  [confirmed by ${i.verifiedBy}]`
      : i.needsConfirm
        ? "  [UNCONFIRMED: meaning depends on facial expression]"
        : "";
    return `  ${formatTime(i.ts)}  ${i.text}${status}`;
  };
  const section = (title: string, items: NoteItem[], always = false) => {
    if (!items.length && !always) return;
    out.push("", title, ...(items.length ? items.map(line) : ["  None recorded."]));
  };
  section("REPORTED", note.reported, true);
  section("DENIES", note.denied, true);
  section("PATIENT ASKED", note.patientQuestions);
  section("CLINICIAN SAID", note.clinicianReplies);
  section("PATIENT ANSWERED", note.patientAnswers);

  out.push("", "PAIN MAP");
  if (note.pain.length) {
    for (const p of note.pain) out.push(`  ${p.label}: peak ${p.peak}/10, latest ${p.latest}/10, ${p.trend}`);
  } else {
    out.push("  No pain reported on the body map.");
  }

  section("URGENT FLAGS", note.urgentFlags);
  if (note.unconfirmedCount) {
    out.push("", `UNCONFIRMED LINES: ${note.unconfirmedCount}. Confirm with the patient before signing.`);
  }
  return out.join("\n");
}
