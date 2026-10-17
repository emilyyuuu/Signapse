import { Hono } from "hono";
import { z } from "zod";
import { assessUtterance, buildChartNote, visitLog, type ChartNote, type ReviewData } from "@synapse/shared";
import type { Store } from "../db/client.js";
import { geminiNoteSummary, type GeminiConfig } from "../language/gemini.js";
import { broadcast } from "../ws/rooms.js";

const uuid = z.string().uuid();
const verifySchema = z.object({ clinicianId: z.string().min(1).max(64) }).strict();

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
    const row = await store.verifyUtterance(id, parsed.data.clinicianId);
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
    if (gemini && log) note.aiSummary = (await geminiNoteSummary(log, gemini)) ?? undefined;
    return c.json(note);
  });

  return r;
}
