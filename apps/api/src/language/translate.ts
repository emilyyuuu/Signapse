import { buildClinicalSentence, describeFace, keepsSigns, type GrammarFlag, type TranslateResult } from "@signapse/shared";
import { geminiSentence, type GeminiConfig } from "./gemini.js";

// Signs + facial grammar -> clinical sentence. Priority and confirmation come
// from fixed rules; Gemini only writes the wording, guided by the flag and the
// facial cues, with the rule-based sentence as the fallback.
export async function translateClause(
  gloss: string[],
  flag: GrammarFlag,
  confidence: number | undefined,
  nmm: Record<string, number | string> | undefined,
  gemini: GeminiConfig | null,
): Promise<TranslateResult> {
  const face = describeFace(nmm, flag);
  const base = buildClinicalSentence(gloss, flag, confidence, face.strong);
  const written = gemini ? await geminiSentence(gloss, flag, face, gemini) : null;
  // If Gemini dropped a symptom, place, side or the rating, the rule-based sentence is used.
  const ai = written && keepsSigns(gloss, written) ? written : null;
  if (written && !ai) console.warn("Gemini sentence left out part of the signs; using the rule-based sentence.");
  return { ...base, sentence: ai ?? base.sentence, source: ai ? "gemini" : "template", face: face.summary };
}
