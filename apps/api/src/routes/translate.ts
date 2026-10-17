import { Hono } from "hono";
import { z } from "zod";
import type { ClauseResult } from "@synapse/shared";
import type { Store } from "../db/client.js";
import type { GeminiConfig } from "../language/gemini.js";
import { translateClause } from "../language/translate.js";
import { broadcast } from "../ws/rooms.js";
import { confidenceSchema, glossSchema, grammarFlagSchema, nmmSchema } from "./schemas.js";

const translateSchema = z
  .object({ gloss: glossSchema, grammarFlag: grammarFlagSchema, confidence: confidenceSchema.optional() })
  .strict();

const clauseSchema = z
  .object({
    encounterId: z.string().uuid(),
    gloss: glossSchema,
    grammarFlag: grammarFlagSchema,
    confidence: confidenceSchema.optional(),
    nmm: nmmSchema.optional(),
  })
  .strict();

export function translateRoutes(store: Store, gemini: GeminiConfig | null) {
  const r = new Hono();

  // Preview only: returns the sentence without saving or sending it.
  r.post("/translate", async (c) => {
    const parsed = translateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { gloss, grammarFlag, confidence } = parsed.data;
    return c.json(await translateClause(gloss, grammarFlag, confidence, gemini));
  });

  // What sign recognition calls when the patient pauses: signs + facial grammar
  // in, clinical sentence saved and pushed to the clinician screen.
  r.post("/clauses", async (c) => {
    const parsed = clauseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { encounterId, gloss, grammarFlag, confidence, nmm } = parsed.data;
    if (!(await store.getEncounter(encounterId))) return c.json({ error: "unknown encounter" }, 404);

    const t = await translateClause(gloss, grammarFlag, confidence, gemini);
    const utterance = await store.insertUtterance({
      encounterId,
      speaker: "patient",
      kind: "sign",
      gloss,
      nmm,
      grammarFlag,
      sentence: t.sentence,
      confidence,
    });
    broadcast(encounterId, { type: "utterance", data: utterance });

    const result: ClauseResult = {
      utterance,
      priority: t.priority,
      needsConfirm: t.needsConfirm,
      source: t.source,
    };
    return c.json(result, 201);
  });

  return r;
}
