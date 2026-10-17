import type { ClinicalSentence, GrammarFlag, Priority } from "./types";

// Rule-based clinical sentences. This is the fallback when Gemini is slow or
// offline, and the source of truth for priority and confirmation, which never
// depend on the language model.

const ZONES: Record<string, string> = {
  HEAD: "head",
  CHEST: "chest",
  STOMACH: "abdominal",
  BACK: "back",
};

const SYMPTOMS: Record<string, string> = {
  DIZZY: "dizziness",
  NAUSEA: "nausea",
  FEVER: "a fever",
};

const URGENT_COMPLAINTS = new Set(["chest pain", "difficulty breathing"]);

export function complaintOf(gloss: string[]): { complaint?: string; zone?: string } {
  const zone = gloss.map((g) => ZONES[g]).find(Boolean);
  if (gloss.includes("BREATHE")) return { complaint: "difficulty breathing", zone: "chest" };
  if (gloss.includes("PAIN")) {
    return { complaint: zone === "head" ? "a headache" : zone ? `${zone} pain` : "pain", zone };
  }
  return { complaint: gloss.map((g) => SYMPTOMS[g]).find(Boolean), zone };
}

function severe(complaint: string) {
  return complaint.startsWith("a ") ? `a severe ${complaint.slice(2)}` : `severe ${complaint}`;
}

export function templateSentence(gloss: string[], flag: GrammarFlag): string {
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
      return `The patient reports ${severe(complaint)}.`;
    default:
      return `The patient reports ${complaint}.`;
  }
}

export function assessPriority(gloss: string[], flag: GrammarFlag): Priority {
  const { complaint } = complaintOf(gloss);
  const affirmed = flag === "statement" || flag === "intensified";
  return complaint && URGENT_COMPLAINTS.has(complaint) && affirmed ? "urgent" : "routine";
}

export function buildClinicalSentence(
  gloss: string[],
  flag: GrammarFlag,
  confidence?: number,
): ClinicalSentence {
  const { complaint, zone } = complaintOf(gloss);
  return {
    sentence: templateSentence(gloss, flag),
    complaint,
    zone,
    priority: assessPriority(gloss, flag),
    // A misread facial marker flips the meaning, so the clinician confirms it.
    needsConfirm: flag !== "statement" || (confidence ?? 1) < 0.7,
  };
}
