import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

// Behind a hosting proxy (Render, Fly) every request comes from the proxy, so
// the real client is in X-Forwarded-For. Only trust that header when told to,
// since a client can set it to anything.
const trustProxy = process.env.TRUST_PROXY === "true";

function clientIp(c: Context) {
  if (trustProxy) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  return getConnInfo(c).remote.address ?? "unknown";
}

// Fixed-window limit per client IP. Over the limit: 429 with Retry-After.
// In memory, so it resets on restart and is per server instance; enough to
// stop a runaway script or a spammer from draining the Gemini quota.
export function rateLimit(name: string, max: number, windowMs = 60_000): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    const key = clientIp(c);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json({ error: `too many requests (${name}), try again shortly` }, 429);
    }
    await next();
  };
}
