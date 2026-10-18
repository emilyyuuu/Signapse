import { BODY_VIEWS, ZONE_LABELS, ZONE_PARENT } from "./bodyZones";
import type { ClinicalSentence, GrammarFlag, Priority, StoredUtterance } from "./types";

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

// Pointing at your own body arrives as a gloss token, e.g. POINT-CHEST.
const POINT_PREFIX = "POINT-";
// A hand can't be seen behind the body, so BACK + pointing at the front means its back.
const BACK_OF: Record<string, string> = {
  head: "headback",
  ...Object.fromEntries(BODY_VIEWS.face.map((z) => [z.id, "headback"])),
  neck: "neckback",
  chest: "upperback",
  rchest: "rupperback",
  lchest: "lupperback",
  abdomen: "lowerback",
  navel: "lowerback",
  ruq: "rlowerback",
  rlq: "rlowerback",
  luq: "llowerback",
  llq: "llowerback",
  pelvis: "buttocks",
};
const ZONE_ADJ: Record<string, string> = {
  abdomen: "abdominal",
  ruq: "right upper abdominal",
  luq: "left upper abdominal",
  rlq: "right lower abdominal",
  llq: "left lower abdominal",
};

// Coarse region of a zone: lchest -> chest, nose -> head, chest -> chest.
export const regionOf = (zone: string) => ZONE_PARENT[zone] ?? zone;

export const pointGloss = (zone: string) => `${POINT_PREFIX}${zone.toUpperCase()}`;

// Zone the patient pointed at in this clause, if any.
export function pointedZone(gloss: string[]): string | undefined {
  const token = gloss.find((g) => g.startsWith(POINT_PREFIX));
  const zone = token?.slice(POINT_PREFIX.length).toLowerCase();
  if (!zone || !(zone in ZONE_LABELS)) return undefined;
  return gloss.includes("BACK") ? (BACK_OF[zone] ?? zone) : zone;
}

function zoneAdj(zone: string) {
  return ZONE_ADJ[zone] ?? ZONE_LABELS[zone].toLowerCase();
}

const SYMPTOMS: Record<string, string> = {
  DIZZY: "dizziness",
  NAUSEA: "nausea",
  FEVER: "a fever",
};

// Urgent whenever the patient affirms them: breathing trouble, and pain anywhere in
// these regions (chest pain on either side counts).
const URGENT_COMPLAINTS = new Set(["difficulty breathing"]);
const URGENT_PAIN_REGIONS = new Set(["chest"]);
// Severe pain in these zones or regions is urgent, following ER triage practice
// for severe central pain. Face parts other than the forehead are not central.
// To be reviewed by someone with clinical knowledge (task L1).
const CENTRAL_ZONES = new Set(["head", "headback", "forehead"]);
const CENTRAL_REGIONS = new Set(["chest", "abdomen"]);
const isCentral = (zone: string) => CENTRAL_ZONES.has(zone) || CENTRAL_REGIONS.has(regionOf(zone));
const SEVERE_PAIN = 8; // on the 0–10 scale

export function complaintOf(gloss: string[]): { complaint?: string; zone?: string } {
  // Where the patient pointed beats a signed location.
  const pointed = pointedZone(gloss);
  const loc = pointed ? { zone: pointed, adj: zoneAdj(pointed) } : gloss.map((g) => ZONES[g]).find(Boolean);
  const zone = loc?.zone;
  if (gloss.includes("BREATHE")) return { complaint: "difficulty breathing", zone: "chest" };
  if (gloss.includes("PAIN")) {
    const complaint =
      zone === "head" ? "a headache" : zone === "navel" ? "pain around the navel" : loc ? `${loc.adj} pain` : "pain";
    return { complaint, zone };
  }
  return { complaint: gloss.map((g) => SYMPTOMS[g]).find(Boolean), zone };
}

// Body-map readings use the same triage rule as signed severe pain.
export function painPriority(zone: string, severity: number): Priority {
  return severity >= SEVERE_PAIN && isCentral(zone) ? "urgent" : "routine";
}

function intensify(complaint: string, word: string) {
  return complaint.startsWith("a ") ? `a ${word} ${complaint.slice(2)}` : `${word} ${complaint}`;
}

// faceStrong: whether the facial markers were strong. Undefined (no face scores)
// keeps the stronger wording, so emphasis is never understated.
// A pain level signed as a number, 0 to 10. Sign recognition sends the label NUM-<n>
// (NUM-0 ... NUM-10); the patient can instead tap a number on the pain scale.
export function signedLevel(gloss: string[]): number | undefined {
  for (const g of gloss) {
    const m = /^NUM-([0-9]{1,2})$/.exec(g);
    if (m && Number(m[1]) <= 10) return Number(m[1]);
  }
  return undefined;
}

export function templateSentence(gloss: string[], flag: GrammarFlag, faceStrong?: boolean): string {
  const level = signedLevel(gloss);
  if (level !== undefined && !complaintOf(gloss).complaint) {
    return `The patient rates the pain ${level} out of 10.`;
  }
  if (gloss.length === 1 && (gloss[0] === "YES" || gloss[0] === "NO")) {
    return `The patient answers ${gloss[0].toLowerCase()}.`;
  }
  const { complaint } = complaintOf(gloss);
  if (!complaint) {
    const pointed = pointedZone(gloss);
    if (!pointed) return `The patient signed: ${gloss.join(" ")}.`;
    const where = `the ${ZONE_LABELS[pointed].toLowerCase()}`;
    const signs = gloss.filter((g) => !g.startsWith(POINT_PREFIX));
    return signs.length ? `The patient signed: ${signs.join(" ")}, pointing to ${where}.` : `The patient points to ${where}.`;
  }
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
  const urgentPain = gloss.includes("PAIN") && zone !== undefined && URGENT_PAIN_REGIONS.has(regionOf(zone));
  const redFlag = ((complaint !== undefined && URGENT_COMPLAINTS.has(complaint)) || urgentPain) && affirmed;
  const severeCentralPain = flag === "intensified" && gloss.includes("PAIN") && zone !== undefined && isCentral(zone);
  return redFlag || severeCentralPain ? "urgent" : "routine";
}

// Urgency and confirmation for a stored line, shared by the clinician screen,
// the review screen and the chart note so they always agree.
export function assessUtterance(u: StoredUtterance) {
  const signed = u.speaker === "patient" && u.kind === "sign" && !!u.gloss && !!u.grammarFlag;
  const needsConfirm = signed ? needsConfirmation(u.grammarFlag, u.confidence) : false;
  return {
    urgent: signed ? assessPriority(u.gloss!, u.grammarFlag!) === "urgent" : false,
    needsConfirm,
    confirmed: !!u.verifiedBy,
    unconfirmed: needsConfirm && !u.verifiedBy,
  };
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
