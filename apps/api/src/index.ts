import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { config } from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { createStore } from "./db/client.js";
import { rateLimit } from "./rateLimit.js";
import { eventRoutes } from "./routes/events.js";
import { cameraRoutes } from "./routes/camera.js";
import { reviewRoutes } from "./routes/review.js";
import { translateRoutes } from "./routes/translate.js";
import { attachRooms } from "./ws/rooms.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

const store = createStore(process.env.DATABASE_URL || undefined);

const gemini = process.env.GEMINI_API_KEY
  ? {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
      timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 3000),
      maxPerMinute: Number(process.env.GEMINI_MAX_PER_MINUTE || 30),
    }
  : null;

const app = new Hono();
app.use("*", cors({ origin: allowedOrigins }));
// Events are a few hundred bytes of text; anything large is rejected outright.
app.use("*", bodyLimit({ maxSize: 16 * 1024 }));
// Per-client limits. Routes that call Gemini get a tighter one; every write
// gets a looser one (a patient tapping the body map stays far below it).
const geminiLimit = rateLimit("translation", Number(process.env.RATE_LIMIT_GEMINI || 30));
const writeLimit = rateLimit("writes", Number(process.env.RATE_LIMIT_WRITES || 120));
app.use("/clauses", geminiLimit);
app.use("/translate", geminiLimit);
app.use("/encounters/:id/note", geminiLimit);
app.on("POST", "*", writeLimit);

app.get("/health", (c) => c.json({ ok: true, store: store.kind }));
app.route("/", eventRoutes(store));
app.route("/", translateRoutes(store, gemini));
app.route("/", reviewRoutes(store, gemini));
app.route("/", cameraRoutes(store));

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `Signapse API on :${info.port} (store: ${store.kind}, sentences: ${gemini ? gemini.model : "templates only"})`,
  );
});
attachRooms(server as Server, allowedOrigins);
