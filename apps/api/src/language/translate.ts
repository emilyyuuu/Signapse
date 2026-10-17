import { buildClinicalSentence, type GrammarFlag, type TranslateResult } from "@synapse/shared";
import { geminiSentence, type GeminiConfig } from "./gemini.js";

// Signs + facial-grammar flag -> clinical sentence. Priority and confirmation
// come from fixed rules; Gemini only writes the wording, with the rule-based
// sentence as the fallback.
export async function translateClause(
  gloss: string[],
  flag: GrammarFlag,
  confidence: number | undefined,
  gemini: GeminiConfig | null,
): Promise<TranslateResult> {
  const base = buildClinicalSentence(gloss, flag, confidence);
  const ai = gemini ? await geminiSentence(gloss, flag, gemini) : null;
  return { ...base, sentence: ai ?? base.sentence, source: ai ? "gemini" : "template" };
}
