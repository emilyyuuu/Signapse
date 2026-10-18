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
  FACE: { zone: "head", adj: "facial" },
  JAW: { zone: "jaw", adj: "jaw" },
  // HEADACHE is one sign for PAIN + HEAD.
  HEADACHE: { zone: "head", adj: "head" },
};

// Signs that mean pain on their own.
const PAIN_SIGNS = ["PAIN", "HEADACHE"];
const hasPain = (gloss: string[]) => gloss.some((g) => PAIN_SIGNS.includes(g));

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
  VOMIT: "vomiting",
  COUGH: "a cough",
  CHILLS: "chills",
  TIRED: "tiredness",
  WEAK: "weakness",
  FAINT: "feeling faint",
  NUMB: "numbness",
  RASH: "a rash",
  ITCH: "itching",
  SWELLING: "swelling",
  BLEEDING: "bleeding",
  DIARRHEA: "diarrhea",
  ALLERGY: "an allergic reaction",
  ANXIOUS: "anxiety",
  HEARTATTACK: "signs of a heart attack",
};

// Urgent whenever the patient affirms them: breathing trouble, and pain anywhere in
// these regions (chest pain on either side counts).
const URGENT_COMPLAINTS = new Set(["difficulty breathing", "signs of a heart attack"]);
const URGENT_PAIN_REGIONS = new Set(["chest"]);
// Before the patient rates it, a strong frown about pain in these zones or regions
// counts as severe. Face parts other than the forehead are not central.
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
  // Every symptom signed is kept: NAUSEA FEVER is "nausea and a fever", not just nausea.
  const parts = [...new Set(gloss.map((g) => SYMPTOMS[g]).filter(Boolean))];
  // Without pain, a pointed place goes with the symptom: "itching at the left hand".
  if (!hasPain(gloss) && pointed && parts.length) {
    return { complaint: `${joinAnd(parts)} at the ${ZONE_LABELS[pointed].toLowerCase()}`, zone };
  }
  if (hasPain(gloss)) {
    const pain =
      zone === "head" && loc?.adj === "head"
        ? "a headache"
        : zone === "navel"
          ? "pain around the navel"
          : loc
            ? `${loc.adj} pain`
            : "pain";
    parts.unshift(pain);
  }
  return { complaint: parts.length ? joinAnd(parts) : undefined, zone };
}

const joinAnd = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

// The patient's own 0–10 rating: 8 or more is severe pain, urgent wherever it is
// (severe pain is a standard reason for a faster triage level). Also used for
// body-map readings, so both agree. To be reviewed by someone with clinical knowledge.
export function painPriority(_zone: string, severity: number): Priority {
  return severity >= SEVERE_PAIN ? "urgent" : "routine";
}

// Once the patient has rated their pain, the meaning is their answer, not a guess
// from their face: a frown while signing doesn't make a 2 severe, and a head shake
// doesn't make a 10 a denial. So a rated pain clause is read as a plain report.
export function ratedFlag(gloss: string[], flag: GrammarFlag): GrammarFlag {
  return hasPain(gloss) && signedLevel(gloss) !== undefined ? "statement" : flag;
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

export function templateSentence(gloss: string[], faceFlag: GrammarFlag, faceStrong?: boolean): string {
  const flag = ratedFlag(gloss, faceFlag);
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
    if (!pointed) return `The patient signed: ${gloss.filter((g) => signedLevel([g]) === undefined).join(" ")}.`;
    const where = `the ${ZONE_LABELS[pointed].toLowerCase()}`;
    const signs = gloss.filter((g) => !g.startsWith(POINT_PREFIX) && signedLevel([g]) === undefined);
    return signs.length ? `The patient signed: ${signs.join(" ")}, pointing to ${where}.` : `The patient points to ${where}.`;
  }
  // The patient's own 0–10 rating, when they gave one for something they have.
  const rated = level !== undefined ? `, rated ${level} out of 10` : "";
  switch (flag) {
    case "question":
      return `The patient is asking about ${complaint}.`;
    case "negation":
      return `The patient denies ${complaint}.`;
    case "intensified":
      return `The patient reports ${intensify(complaint, faceStrong === false ? "significant" : "severe")}${rated}.`;
    default:
      return `The patient reports ${complaint}${rated}.`;
  }
}

export function assessPriority(gloss: string[], faceFlag: GrammarFlag): Priority {
  const flag = ratedFlag(gloss, faceFlag);
  const { complaint, zone } = complaintOf(gloss);
  const level = signedLevel(gloss);
  // Rated 0: they have no pain there, whatever else was signed.
  if (hasPain(gloss) && level === 0) return "routine";
  const affirmed = flag === "statement" || flag === "intensified";
  const urgentPain = hasPain(gloss) && zone !== undefined && URGENT_PAIN_REGIONS.has(regionOf(zone));
  // Checked sign by sign, so "nausea and signs of a heart attack" still counts.
  const urgentSymptom =
    (complaint !== undefined && URGENT_COMPLAINTS.has(complaint)) || gloss.some((g) => URGENT_COMPLAINTS.has(SYMPTOMS[g]));
  const redFlag = (urgentSymptom || urgentPain) && affirmed;
  // Not rated yet: a strong frown about central pain stands in for "severe".
  const severeCentralPain =
    level === undefined && flag === "intensified" && hasPain(gloss) && zone !== undefined && isCentral(zone);
  // Rated: 8 or more is urgent anywhere (the same rule as the body map).
  const ratedSevere = hasPain(gloss) && level !== undefined && painPriority(zone ?? "", level) === "urgent";
  return redFlag || severeCentralPain || ratedSevere ? "urgent" : "routine";
}

// Words a written sentence must contain for each sign, so a language model's
// wording can't silently drop a symptom, a place or the rating.
const MUST_SAY: Record<string, RegExp> = {
  PAIN: /pain|ache|hurt/i,
  HEADACHE: /headache/i,
  NAUSEA: /nause|sick/i,
  FEVER: /fever/i,
  DIZZY: /dizz/i,
  BREATHE: /breath/i,
  VOMIT: /vomit/i,
  COUGH: /cough/i,
  CHILLS: /chill/i,
  TIRED: /tired|fatigue/i,
  WEAK: /weak/i,
  FAINT: /faint/i,
  NUMB: /numb/i,
  RASH: /rash/i,
  ITCH: /itch/i,
  SWELLING: /swell/i,
  BLEEDING: /bleed/i,
  DIARRHEA: /diarrh/i,
  ALLERGY: /allerg/i,
  ANXIOUS: /anxi/i,
  HEARTATTACK: /heart/i,
  CHEST: /chest/i,
  STOMACH: /stomach|abdom/i,
  HEAD: /head/i,
  BACK: /back/i,
  FACE: /face|facial/i,
  JAW: /jaw/i,
};

// True when the sentence keeps every sign's meaning: symptoms and places, the
// rating's number, and the side (left/right) of a pointed place.
export function keepsSigns(gloss: string[], sentence: string): boolean {
  for (const g of gloss) {
    if (MUST_SAY[g] && !MUST_SAY[g].test(sentence)) return false;
    const level = signedLevel([g]);
    if (level !== undefined && !new RegExp(`\\b${level}\\b`).test(sentence)) return false;
    if (g.startsWith(POINT_PREFIX)) {
      const side = ZONE_LABELS[g.slice(POINT_PREFIX.length).toLowerCase()]?.match(/^(Left|Right)\b/)?.[1];
      if (side && !new RegExp(`\\b${side}\\b`, "i").test(sentence)) return false;
    }
  }
  return true;
}

// The pain-map reading a signed clause gives: where it hurts and the patient's
// 0–10 rating, once both are known (e.g. PAIN POINT-LCHEST NUM-7).
export function painReadingOf(gloss: string[]): { zone: string; severity: number } | undefined {
  const { zone } = complaintOf(gloss);
  const severity = signedLevel(gloss);
  if (!hasPain(gloss) || zone === undefined || severity === undefined) return undefined;
  return { zone, severity };
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
