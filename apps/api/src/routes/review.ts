import { Hono } from "hono";
import { z } from "zod";
import { assessUtterance, buildChartNote, mentionsName, visitLog, type ChartNote, type ReviewData } from "@signapse/shared";
import type { Store } from "../db/client.js";
import { geminiNoteSummary, type GeminiConfig } from "../language/gemini.js";
import { broadcast } from "../ws/rooms.js";

const uuid = z.string().uuid();
// Clinicians are not identified yet (no sign-in), so confirmations say "Clinician".
// A clinicianId from an old caller is accepted and ignored.
const verifySchema = z.object({ clinicianId: z.string().max(64).optional() }).strict();
const CLINICIAN = "Clinician";

// Chart review: everything for the review screen, confirming lines, and the
// draft chart note.
export function reviewRoutes(store: Store, gemini: GeminiConfig | null) {
  const r = new Hono();

  r.get("/encounters/:id/review", async (c) => {
    const id = c.req.param("id");
    if (!uuid.safeParse(id).success) return c.json({ error: "bad id" }, 400);
    const encounter = await store.getEncounter(id);
    if (!encounter) return c.json({ error: "unknown encounter" }, 404);
    const [utterances, pain, painTrend] = await Promise.all([
      store.listUtterances(id),
      store.listPain(id),
      store.painTrend(id),
    ]);
    const assessed = utterances.map(assessUtterance);
    const result: ReviewData = {
      encounter,
      utterances,
      pain,
      painTrend,
      stats: {
        lines: utterances.length,
        urgent: assessed.filter((a) => a.urgent).length,
        unconfirmed: assessed.filter((a) => a.unconfirmed).length,
      },
    };
    return c.json(result);
  });

  r.post("/utterances/:id/verify", async (c) => {
    const id = c.req.param("id");
    if (!uuid.safeParse(id).success) return c.json({ error: "bad id" }, 400);
    const parsed = verifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const row = await store.verifyUtterance(id, CLINICIAN);
    if (!row) return c.json({ error: "unknown utterance" }, 404);
    broadcast(row.encounterId, { type: "verified", data: row });
    return c.json(row);
  });

  // Facts come from stored data; Gemini only adds a labelled summary paragraph,
  // and the note is complete without it.
  r.post("/encounters/:id/note", async (c) => {
    const id = c.req.param("id");
    if (!uuid.safeParse(id).success) return c.json({ error: "bad id" }, 400);
    const encounter = await store.getEncounter(id);
    if (!encounter) return c.json({ error: "unknown encounter" }, 404);
    const [utterances, pain] = await Promise.all([store.listUtterances(id), store.listPain(id)]);
    const note: ChartNote = buildChartNote(encounter, utterances, pain);
    const log = visitLog(note);
    // Last guard: the patient's name must never reach Gemini. The log is built from
    // sentences and pain readings only, so this should never trigger; if it does, skip the AI.
    const safe = !mentionsName(log, encounter.patientName);
    if (!safe) console.warn("AI summary skipped: the visit text mentions the patient name.");
    if (gemini && log && safe) note.aiSummary = (await geminiNoteSummary(log, gemini)) ?? undefined;
    return c.json(note);
  });

  return r;
}
