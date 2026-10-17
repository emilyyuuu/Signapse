import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { config } from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { createStore } from "./db/client.js";
import { eventRoutes } from "./routes/events.js";
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
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 2500),
    }
  : null;

const app = new Hono();
app.use("*", cors({ origin: allowedOrigins }));
// Events are a few hundred bytes of text; anything large is rejected outright.
app.use("*", bodyLimit({ maxSize: 16 * 1024 }));
app.get("/health", (c) => c.json({ ok: true, store: store.kind }));
app.route("/", eventRoutes(store));
app.route("/", translateRoutes(gemini));

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `Synapse API on :${info.port} (store: ${store.kind}, sentences: ${gemini ? gemini.model : "templates only"})`,
  );
});
attachRooms(server as Server, allowedOrigins);
