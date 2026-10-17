import { Hono } from "hono";
import { z } from "zod";
import { buildClinicalSentence, type TranslateResult } from "@synapse/shared";
import { geminiSentence, type GeminiConfig } from "../language/gemini.js";

// Gloss labels only (e.g. PAIN, CHEST): uppercase sign names, so no free text
// such as names or notes can reach the language model.
const translateSchema = z
  .object({
    gloss: z.array(z.string().regex(/^[A-Z][A-Z0-9-]{0,24}$/)).min(1).max(20),
    grammarFlag: z.enum(["statement", "question", "negation", "intensified"]),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export function translateRoutes(gemini: GeminiConfig | null) {
  const r = new Hono();

  r.post("/translate", async (c) => {
    const parsed = translateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { gloss, grammarFlag, confidence } = parsed.data;

    // Priority and confirmation come from fixed rules; Gemini only writes the wording.
    const base = buildClinicalSentence(gloss, grammarFlag, confidence);
    const ai = gemini ? await geminiSentence(gloss, grammarFlag, gemini) : null;
    const result: TranslateResult = {
      ...base,
      sentence: ai ?? base.sentence,
      source: ai ? "gemini" : "template",
    };
    return c.json(result);
  });

  return r;
}
