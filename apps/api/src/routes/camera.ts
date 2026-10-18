import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { z } from "zod";
import type { Store } from "../db/client.js";
import { openEncounterError } from "./events.js";

// Starts and stops the pointing camera (apps/pointing) on the machine the API
// runs on, so the patient page can switch it on with one click.
//
// This launches a process, so it is locked down:
//   - off unless LOCAL_CAMERA=true (hosted servers leave it off);
//   - only requests from this machine (loopback) are accepted, never a proxy;
//   - one fixed command; the only input is a visit id, validated as a UUID;
//   - the child does not get the database URL or the Gemini key.

const pointingDir = fileURLToPath(new URL("../../../pointing/", import.meta.url));
const isWindows = process.platform === "win32";
const pythonPath = `${pointingDir}.venv/${isWindows ? "Scripts/python.exe" : "bin/python"}`;

// Read at request time: .env is loaded after this module is imported.
const isEnabled = () => process.env.LOCAL_CAMERA === "true" && process.env.TRUST_PROXY !== "true";
const apiPort = () => Number(process.env.PORT ?? 8787);

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

interface Running {
  child: ChildProcess;
  encounterId: string;
  startedAt: number;
}

let running: Running | null = null;
let lastExit: { code: number | null; at: number } | null = null;
const logTail: string[] = [];

function remember(chunk: Buffer) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    const t = line.trim();
    // MediaPipe prints harmless warnings; keep real lines only.
    if (t && !/inference_feedback_manager|landmark_projection_calculator|InitGoogle|XNNPACK/.test(t)) {
      logTail.push(t.slice(0, 300));
      if (logTail.length > 12) logTail.shift();
    }
  }
}

function stop() {
  if (!running) return;
  const { child } = running;
  running = null;
  if (isWindows && child.pid) {
    // Kill the whole tree on Windows (python may have helper threads/processes).
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(0));

const startSchema = z.object({ encounterId: z.string().uuid() }).strict();

export function cameraRoutes(store: Store) {
  const r = new Hono();

  // Every camera route: this machine only, and only when switched on.
  r.use("/camera/*", async (c, next) => {
    const remote = getConnInfo(c).remote.address ?? "";
    if (!isEnabled()) {
      return c.json({ error: "The camera launcher is off on this server (set LOCAL_CAMERA=true to turn it on)." }, 403);
    }
    if (!LOOPBACK.has(remote)) return c.json({ error: "The camera can only be started from this computer." }, 403);
    await next();
  });

  r.get("/camera/status", (c) =>
    c.json({
      available: existsSync(pythonPath),
      running: !!running,
      encounterId: running?.encounterId,
      exited: !running && lastExit ? { code: lastExit.code } : undefined,
      log: logTail.slice(-4),
    }),
  );

  r.post("/camera/start", async (c) => {
    const parsed = startSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad request" }, 400);
    const { encounterId } = parsed.data;
    const closed = await openEncounterError(store, encounterId);
    if (closed) return c.json({ error: closed.error }, closed.status);
    if (!existsSync(pythonPath)) {
      return c.json(
        {
          error:
            "The camera program isn't installed on this computer yet. In apps/pointing: python -m venv .venv, then .venv/Scripts/python -m pip install -e .[dev], then scripts/fetch_models.sh.",
        },
        503,
      );
    }
    if (running && running.encounterId === encounterId && running.child.exitCode === null) {
      return c.json({ running: true, encounterId });
    }
    stop();
    logTail.length = 0;
    lastExit = null;

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.DATABASE_URL;
    delete env.GEMINI_API_KEY;
    Object.assign(env, {
      SIGNAPSE_ENCOUNTER: encounterId,
      SIGNAPSE_API_URL: `http://127.0.0.1:${apiPort()}`,
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    });
    const child = spawn(pythonPath, ["-m", "pointing.lab", "--no-window"], {
      cwd: pointingDir,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", remember);
    child.stderr?.on("data", remember);
    child.on("error", (err) => remember(Buffer.from(`Could not start: ${err.message}`)));
    child.on("exit", (code) => {
      if (running?.child === child) running = null;
      lastExit = { code, at: Date.now() };
    });
    running = { child, encounterId, startedAt: Date.now() };
    return c.json({ running: true, encounterId }, 201);
  });

  r.post("/camera/stop", (c) => {
    stop();
    return c.json({ running: false });
  });

  return r;
}
