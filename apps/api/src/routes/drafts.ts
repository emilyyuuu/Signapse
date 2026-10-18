import { Hono } from "hono";
import { z } from "zod";
import { isAllowedSign, painReadingOf, ratedFlag, type PatientConfirmation } from "@signapse/shared";
import type { Store } from "../db/client.js";
import {
  editDraft,
  holdDraft,
  isUrgent,
  noteRedo,
  noteSent,
  restoreDraft,
  setAutoSendHandler,
  takeDraft,
  view,
  type Draft,
} from "../drafts.js";
import type { GeminiConfig } from "../language/gemini.js";
import { translateClause } from "../language/translate.js";
import { broadcast } from "../ws/rooms.js";
import { openEncounterError } from "./events.js";
import { glossSchema, grammarFlagSchema } from "./schemas.js";

const uuid = z.string().uuid();
const bodyWithDraft = z.object({ draftId: uuid }).strict();
const editSchema = z
  .object({
    draftId: uuid,
    gloss: glossSchema.refine((g) => g.length <= 8 && g.every(isAllowedSign), "unknown or too many signs").optional(),
    grammarFlag: grammarFlagSchema.optional(),
  })
  .strict()
  .refine((v) => v.gloss || v.grammarFlag, "nothing to change");

const gone = { error: "That message is no longer waiting." };

export function draftRoutes(store: Store, gemini: GeminiConfig | null) {
  const r = new Hono();

  // The patient said it is right (or an urgent draft ran out of time): write the
  // doctor's sentence, save it with how it was confirmed, and send it live.
  async function finalize(d: Draft, action: PatientConfirmation["action"]) {
    // The patient is waiting for "Sent", so Gemini gets a short limit here and the instant
    // rule-based sentence takes over if it is slow. Auto-sends are urgent: no Gemini at all.
    const quick = gemini ? { ...gemini, timeoutMs: Math.min(gemini.timeoutMs, 1500) } : null;
    // A rated pain clause is the patient's own answer: saved and worded as a plain report.
    const grammarFlag = ratedFlag(d.gloss, d.grammarFlag);
    const t = await translateClause(d.gloss, grammarFlag, d.confidence, d.nmm, action === "auto_sent" ? null : quick);
    const patientConfirmation: PatientConfirmation = {
      action,
      redos: d.redos,
      ...(d.original ? { original: d.original } : {}),
    };
    const utterance = await store.insertUtterance({
      encounterId: d.encounterId,
      speaker: "patient",
      kind: "sign",
      gloss: d.gloss,
      nmm: d.nmm,
      grammarFlag,
      sentence: t.sentence,
      confidence: d.confidence,
      patientConfirmation,
    });
    broadcast(d.encounterId, { type: "utterance", data: utterance });
    broadcast(d.encounterId, { type: "draft_closed", data: { id: d.id, action } }, "patient");
    // Where it hurts and how much also go on the doctor's pain map.
    const reading = painReadingOf(d.gloss);
    if (reading) {
      await store
        .insertPain({ encounterId: d.encounterId, ...reading, source: d.gloss.some((g) => g.startsWith("POINT-")) ? "pointing" : "tap" })
        .then((row) => broadcast(d.encounterId, { type: "pain", data: row }))
        .catch((err) => console.warn("could not save pain reading:", err.message));
    }
    await store
      .insertPatientAction({
        encounterId: d.encounterId,
        draftId: d.id,
        action,
        urgent: isUrgent(d),
        detail: { gloss: d.gloss, grammarFlag: d.grammarFlag },
      })
      .catch((err) => console.warn("could not log patient action:", err.message));
    noteSent(d.encounterId);
    return utterance;
  }

  // Never lose a message: if saving fails, put the draft back so it can be sent again.
  async function finalizeSafely(d: Draft, action: PatientConfirmation["action"], retryMs?: number) {
    try {
      return await finalize(d, action);
    } catch (err) {
      console.warn(`could not send draft: ${(err as Error).message}`);
      restoreDraft(d, retryMs);
      throw err;
    }
  }

  setAutoSendHandler((d) => {
    const taken = takeDraft(d.encounterId, d.id);
    if (taken) void finalizeSafely(taken, "auto_sent", 3000).catch(() => {});
  });

  r.post("/encounters/:id/draft/send", async (c) => {
    const id = c.req.param("id");
    const parsed = bodyWithDraft.safeParse(await c.req.json().catch(() => null));
    if (!uuid.safeParse(id).success || !parsed.success) return c.json({ error: "bad request" }, 400);
    const closed = await openEncounterError(store, id);
    if (closed) return c.json({ error: closed.error }, closed.status);
    const d = takeDraft(id, parsed.data.draftId);
    if (!d) return c.json(gone, 409);
    try {
      const utterance = await finalizeSafely(d, d.edited ? "edited" : "sent");
      return c.json({ sent: true, utterance }, 201);
    } catch {
      return c.json({ error: "Could not send. Try again." }, 502);
    }
  });

  // Sign again: drop the draft, remember that it was redone.
  r.post("/encounters/:id/draft/redo", async (c) => {
    const id = c.req.param("id");
    const parsed = bodyWithDraft.safeParse(await c.req.json().catch(() => null));
    if (!uuid.safeParse(id).success || !parsed.success) return c.json({ error: "bad request" }, 400);
    const d = takeDraft(id, parsed.data.draftId);
    if (!d) return c.json(gone, 409);
    noteRedo(id);
    broadcast(id, { type: "draft_closed", data: { id: d.id, action: "redone" } }, "patient");
    await store
      .insertPatientAction({
        encounterId: id,
        draftId: d.id,
        action: "redone",
        urgent: isUrgent(d),
        detail: { gloss: d.gloss, grammarFlag: d.grammarFlag },
      })
      .catch((err) => console.warn("could not log patient action:", err.message));
    return c.json({ redone: true });
  });

  // Fix what the camera understood by choosing the right meaning or signs.
  r.post("/encounters/:id/draft/edit", async (c) => {
    const id = c.req.param("id");
    const parsed = editSchema.safeParse(await c.req.json().catch(() => null));
    if (!uuid.safeParse(id).success || !parsed.success) return c.json({ error: "bad request" }, 400);
    const d = editDraft(id, parsed.data.draftId, { gloss: parsed.data.gloss, grammarFlag: parsed.data.grammarFlag });
    if (!d) return c.json(gone, 409);
    return c.json(view(d));
  });

  // The edit panel is open: give an urgent draft more time.
  r.post("/encounters/:id/draft/hold", async (c) => {
    const id = c.req.param("id");
    const parsed = bodyWithDraft.safeParse(await c.req.json().catch(() => null));
    if (!uuid.safeParse(id).success || !parsed.success) return c.json({ error: "bad request" }, 400);
    const d = holdDraft(id, parsed.data.draftId);
    if (!d) return c.json(gone, 409);
    return c.json(view(d));
  });

  return r;
}
