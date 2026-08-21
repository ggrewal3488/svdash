import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";

/**
 * Shared-secret auth for device-service. This is the process with actual
 * control over the physical lock hardware (via bridge32 — see
 * bridge32Client.ts) — an open /cards/encode would let anything on the
 * network trigger a card write. Mirrors server/src/auth.ts's requireApiKey
 * so the two services behave the same way operationally.
 */
function suppliedKey(req: Request): string {
  const header = req.get("x-api-key");
  if (header) return header;

  const auth = req.get("authorization") ?? "";
  const [scheme, value] = auth.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : "";
}

// Compared with timingSafeEqual rather than === so the check doesn't leak the
// key one character at a time to anything measuring response times.
function matches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.DEVICE_SERVICE_KEY;

  // Refuse to serve rather than fall open: an unset key must never mean
  // "let everyone in" for a service that can write physical key cards.
  if (!expected) {
    console.error("DEVICE_SERVICE_KEY is not set — refusing all requests");
    res.status(503).json({ ok: false, error: "server is not configured for auth" });
    return;
  }

  const supplied = suppliedKey(req);
  if (!supplied || !matches(supplied, expected)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
}
