import { Hono } from "hono";
import { z } from "zod";
import type { ClauseResult } from "@signapse/shared";
import type { Store } from "../db/client.js";
import type { GeminiConfig } from "../language/gemini.js";
import { translateClause } from "../language/translate.js";
import { broadcast } from "../ws/rooms.js";
import { createDraft, isUrgent, view } from "../drafts.js";
import { openEncounterError } from "./events.js";
import { confidenceSchema, glossSchema, grammarFlagSchema, nmmSchema } from "./schemas.js";

const translateSchema = z
  .object({
    gloss: glossSchema,
    grammarFlag: grammarFlagSchema,
    confidence: confidenceSchema.optional(),
    nmm: nmmSchema.optional(),
  })
  .strict();

const clauseSchema = z
  .object({
    encounterId: z.string().uuid(),
    gloss: glossSchema,
    grammarFlag: grammarFlagSchema,
    confidence: confidenceSchema.optional(),
    nmm: nmmSchema.optional(),
    // Skip the patient's check and send straight to the doctor (testing and the wizard).
    direct: z.boolean().optional(),
  })
  .strict();

export function translateRoutes(store: Store, gemini: GeminiConfig | null) {
  const r = new Hono();

  // Preview only: returns the sentence without saving or sending it.
  r.post("/translate", async (c) => {
    const parsed = translateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { gloss, grammarFlag, confidence, nmm } = parsed.data;
    return c.json(await translateClause(gloss, grammarFlag, confidence, nmm, gemini));
  });

  // What sign recognition calls when the patient pauses: signs + facial grammar
  // in, clinical sentence saved and pushed to the clinician screen.
  r.post("/clauses", async (c) => {
    const parsed = clauseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { encounterId, gloss, grammarFlag, confidence, nmm, direct } = parsed.data;
    const closed = await openEncounterError(store, encounterId);
    if (closed) return c.json({ error: closed.error }, closed.status);

    // The patient checks what they signed first. Nothing is saved or sent to the
    // doctor until they press Send; the draft is shown to patient screens only.
    if (!direct && process.env.PATIENT_CONFIRM !== "false") {
      const { draft, replaced } = createDraft({ encounterId, gloss, grammarFlag, confidence, nmm });
      if (replaced) {
        await store
          .insertPatientAction({
            encounterId,
            draftId: replaced.id,
            action: "redone",
            urgent: isUrgent(replaced),
            detail: { gloss: replaced.gloss, grammarFlag: replaced.grammarFlag },
          })
          .catch(() => {});
      }
      return c.json({ status: "waiting_for_patient", draft: view(draft) }, 202);
    }

    const t = await translateClause(gloss, grammarFlag, confidence, nmm, gemini);
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
      face: t.face,
    };
    return c.json(result, 201);
  });

  return r;
}
