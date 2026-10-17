import type { ClinicalSentence, GrammarFlag, Priority } from "./types";

// Rule-based clinical sentences. This is the fallback when Gemini is slow or
// offline, and the source of truth for priority and confirmation, which never
// depend on the language model.

// Location signs: the body-map zone id plus the adjective used in sentences.
const ZONES: Record<string, { zone: string; adj: string }> = {
  HEAD: { zone: "head", adj: "head" },
  CHEST: { zone: "chest", adj: "chest" },
  STOMACH: { zone: "abdomen", adj: "abdominal" },
  BACK: { zone: "lowerback", adj: "back" },
};

const SYMPTOMS: Record<string, string> = {
  DIZZY: "dizziness",
  NAUSEA: "nausea",
  FEVER: "a fever",
};

// Urgent whenever the patient affirms them.
const URGENT_COMPLAINTS = new Set(["chest pain", "difficulty breathing"]);
// Severe pain in these body-map zones is urgent, following ER triage practice
// for severe central pain. To be reviewed by someone with clinical knowledge (task L1).
const CENTRAL_ZONES = new Set(["head", "headback", "chest", "abdomen"]);
const SEVERE_PAIN = 8; // on the 0–10 scale

export function complaintOf(gloss: string[]): { complaint?: string; zone?: string } {
  const loc = gloss.map((g) => ZONES[g]).find(Boolean);
  const zone = loc?.zone;
  if (gloss.includes("BREATHE")) return { complaint: "difficulty breathing", zone: "chest" };
  if (gloss.includes("PAIN")) {
    return { complaint: zone === "head" ? "a headache" : loc ? `${loc.adj} pain` : "pain", zone };
  }
  return { complaint: gloss.map((g) => SYMPTOMS[g]).find(Boolean), zone };
}

// Body-map readings use the same triage rule as signed severe pain.
export function painPriority(zone: string, severity: number): Priority {
  return severity >= SEVERE_PAIN && CENTRAL_ZONES.has(zone) ? "urgent" : "routine";
}

function intensify(complaint: string, word: string) {
  return complaint.startsWith("a ") ? `a ${word} ${complaint.slice(2)}` : `${word} ${complaint}`;
}

// faceStrong: whether the facial markers were strong. Undefined (no face scores)
// keeps the stronger wording, so emphasis is never understated.
export function templateSentence(gloss: string[], flag: GrammarFlag, faceStrong?: boolean): string {
  if (gloss.length === 1 && (gloss[0] === "YES" || gloss[0] === "NO")) {
    return `The patient answers ${gloss[0].toLowerCase()}.`;
  }
  const { complaint } = complaintOf(gloss);
  if (!complaint) return `The patient signed: ${gloss.join(" ")}.`;
  switch (flag) {
    case "question":
      return `The patient is asking about ${complaint}.`;
    case "negation":
      return `The patient denies ${complaint}.`;
    case "intensified":
      return `The patient reports ${intensify(complaint, faceStrong === false ? "significant" : "severe")}.`;
    default:
      return `The patient reports ${complaint}.`;
  }
}

export function assessPriority(gloss: string[], flag: GrammarFlag): Priority {
  const { complaint, zone } = complaintOf(gloss);
  const affirmed = flag === "statement" || flag === "intensified";
  const redFlag = complaint !== undefined && URGENT_COMPLAINTS.has(complaint) && affirmed;
  const severeCentralPain =
    flag === "intensified" && gloss.includes("PAIN") && zone !== undefined && CENTRAL_ZONES.has(zone);
  return redFlag || severeCentralPain ? "urgent" : "routine";
}

// A misread facial marker flips the meaning, so the clinician confirms it.
export function needsConfirmation(flag: GrammarFlag | undefined, confidence?: number) {
  return (flag !== undefined && flag !== "statement") || (confidence ?? 1) < 0.7;
}

export function buildClinicalSentence(
  gloss: string[],
  flag: GrammarFlag,
  confidence?: number,
  faceStrong?: boolean,
): ClinicalSentence {
  const { complaint, zone } = complaintOf(gloss);
  return {
    sentence: templateSentence(gloss, flag, faceStrong),
    complaint,
    zone,
    priority: assessPriority(gloss, flag),
    needsConfirm: needsConfirmation(flag, confidence),
  };
}
