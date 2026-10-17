import { Hono } from "hono";
import { z } from "zod";
import { ZONE_IDS } from "@synapse/shared";
import type { Store } from "../db/client.js";
import { broadcast } from "../ws/rooms.js";
import { confidenceSchema, grammarFlagSchema, nmmSchema } from "./schemas.js";

// Only short text and numbers are accepted, and unknown keys are rejected,
// so there is no field that could carry video, images or landmarks.
const text = (max: number) => z.string().min(1).max(max);

const utteranceSchema = z
  .object({
    encounterId: z.string().uuid(),
    speaker: z.enum(["patient", "clinician"]),
    kind: z.enum(["sign", "reply", "answer"]),
    gloss: z.array(text(40)).max(30).optional(),
    nmm: nmmSchema.optional(),
    grammarFlag: grammarFlagSchema.optional(),
    sentence: text(500),
    plainText: text(500).optional(),
    confidence: confidenceSchema.optional(),
  })
  .strict();

const painSchema = z
  .object({
    encounterId: z.string().uuid(),
    zone: z.enum(ZONE_IDS),
    severity: z.number().int().min(0).max(10),
    source: z.enum(["tap", "pointing"]),
  })
  .strict();

const encounterSchema = z
  .object({ patientRef: text(64), clinicianId: text(64) })
  .strict();

export function eventRoutes(store: Store) {
  const r = new Hono();

  r.post("/events", async (c) => {
    const parsed = utteranceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    if (!(await store.getEncounter(parsed.data.encounterId))) {
      return c.json({ error: "unknown encounter" }, 404);
    }
    const row = await store.insertUtterance(parsed.data);
    broadcast(row.encounterId, { type: "utterance", data: row });
    return c.json(row, 201);
  });

  r.post("/pain", async (c) => {
    const parsed = painSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    if (!(await store.getEncounter(parsed.data.encounterId))) {
      return c.json({ error: "unknown encounter" }, 404);
    }
    const row = await store.insertPain(parsed.data);
    broadcast(row.encounterId, { type: "pain", data: row });
    return c.json(row, 201);
  });

  r.post("/encounters", async (c) => {
    const parsed = encounterSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const e = await store.createEncounter(parsed.data.patientRef, parsed.data.clinicianId);
    return c.json(e, 201);
  });

  r.get("/encounters/:id", async (c) => {
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) return c.json({ error: "bad id" }, 400);
    const encounter = await store.getEncounter(id);
    if (!encounter) return c.json({ error: "unknown encounter" }, 404);
    const [utterances, pain] = await Promise.all([store.listUtterances(id), store.listPain(id)]);
    return c.json({ encounter, utterances, pain });
  });

  return r;
}
