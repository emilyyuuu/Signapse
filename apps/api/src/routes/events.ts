import { randomInt } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { ZONE_IDS, cleanName, type StoredGestureEvent, type StoredPointEvent } from "@signapse/shared";
import type { Store } from "../db/client.js";
import { broadcast } from "../ws/rooms.js";
import { clearEncounter } from "../drafts.js";
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

// The patient is pointing at a zone on their own body. Zone id and a score only.
// A head gesture from the camera: a nod confirms the pointed body part, a shake cancels.
const gestureSchema = z
  .object({
    encounterId: z.string().uuid(),
    gesture: z.enum(["nod", "shake"]),
    confidence: confidenceSchema.optional(),
  })
  .strict();

const pointSchema = z
  .object({
    encounterId: z.string().uuid(),
    zone: z.enum(ZONE_IDS),
    confidence: confidenceSchema,
    gesture: z.enum(["point", "touch"]).optional(),
  })
  .strict();

// All optional: the server generates the patient token. The name is normally typed
// later, at check-in on the patient station (POST /encounters/:id/name).
const nameField = z
  .string()
  .max(200)
  .transform((v, ctx) => {
    const name = cleanName(v);
    if (!name) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That name has letters we can't accept." });
    return name ?? "";
  });
const encounterSchema = z
  .object({
    patientRef: z.string().regex(/^[A-Za-z0-9-]{1,32}$/).optional(),
    patientName: nameField.optional(),
    clinicianId: text(64).optional(), // kept for old callers; the screens no longer ask for it
  })
  .strict();
const checkInSchema = z.object({ name: nameField }).strict();

// Short hospital-style token, e.g. PT-7K3Q, without look-alike characters.
function newPatientRef() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return `PT-${Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join("")}`;
}

// Writes are only accepted while the visit is open.
export async function openEncounterError(store: Store, encounterId: string) {
  const e = await store.getEncounter(encounterId);
  if (!e) return { error: "unknown encounter", status: 404 as const };
  if (e.endedAt) return { error: "this visit has ended", status: 409 as const };
  return null;
}

export function eventRoutes(store: Store) {
  const r = new Hono();

  r.post("/events", async (c) => {
    const parsed = utteranceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const closed = await openEncounterError(store, parsed.data.encounterId);
    if (closed) return c.json({ error: closed.error }, closed.status);
    const row = await store.insertUtterance(parsed.data);
    broadcast(row.encounterId, { type: "utterance", data: row });
    return c.json(row, 201);
  });

  r.post("/pain", async (c) => {
    const parsed = painSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const closed = await openEncounterError(store, parsed.data.encounterId);
    if (closed) return c.json({ error: closed.error }, closed.status);
    const row = await store.insertPain(parsed.data);
    broadcast(row.encounterId, { type: "pain", data: row });
    return c.json(row, 201);
  });

  // Live only, not stored: the clause gloss and the confirmed pain reading are the record.
  r.post("/point", async (c) => {
    const parsed = pointSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const closed = await openEncounterError(store, parsed.data.encounterId);
    if (closed) return c.json({ error: closed.error }, closed.status);
    const point: StoredPointEvent = { ...parsed.data, ts: new Date().toISOString() };
    broadcast(point.encounterId, { type: "point", data: point });
    return c.json(point, 201);
  });

  // Live only, not stored.
  r.post("/gesture", async (c) => {
    const parsed = gestureSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const closed = await openEncounterError(store, parsed.data.encounterId);
    if (closed) return c.json({ error: closed.error }, closed.status);
    const event: StoredGestureEvent = { ...parsed.data, ts: new Date().toISOString() };
    broadcast(event.encounterId, { type: "gesture", data: event });
    return c.json(event, 201);
  });

  r.post("/encounters", async (c) => {
    const parsed = encounterSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const e = await store.createEncounter(
      parsed.data.patientRef ?? newPatientRef(),
      parsed.data.clinicianId ?? "clinician",
      parsed.data.patientName,
    );
    return c.json(e, 201);
  });

  // Check-in: the patient types their name on the patient station. The name travels in
  // the request body (never the URL) and is never logged or sent to Gemini.
  r.post("/encounters/:id/name", async (c) => {
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) return c.json({ error: "bad id" }, 400);
    const parsed = checkInSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Please use letters, spaces, hyphens or apostrophes (up to 60)." }, 400);
    const closed = await openEncounterError(store, id);
    if (closed) return c.json({ error: closed.error }, closed.status);
    const e = await store.setPatientName(id, parsed.data.name);
    if (!e) return c.json({ error: "unknown encounter" }, 404);
    broadcast(id, { type: "encounter", data: e });
    return c.json(e);
  });

  // Open visits, newest first: what a patient station or the vision process joins.
  r.get("/encounters", async (c) => {
    if (c.req.query("active") !== "true") return c.json({ error: "use ?active=true" }, 400);
    return c.json(await store.listActiveEncounters(20));
  });

  r.post("/encounters/:id/end", async (c) => {
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) return c.json({ error: "bad id" }, 400);
    const e = await store.endEncounter(id);
    if (!e) return c.json({ error: "unknown encounter" }, 404);
    clearEncounter(id);
    broadcast(id, { type: "ended", data: e });
    return c.json(e);
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
