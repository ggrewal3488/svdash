import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";

/**
 * Shared-secret auth for the whole API.
 *
 * Every endpoint here exposes guest PII (names, phones, ID document numbers)
 * or moves a guest in and out of a room, so none of it may be open the way
 * the Apps Script's getPromos is. The key is sent as `x-api-key`, or as a
 * bearer token so a browser fetch can use the standard header.
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
  const expected = process.env.MASTER_API_KEY;

  // Refuse to serve rather than fall open: an unset key must never mean
  // "let everyone in", which is exactly how PII gets published by accident.
  if (!expected) {
    console.error("MASTER_API_KEY is not set — refusing all requests");
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
