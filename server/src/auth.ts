import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";

/**
 * Per-user auth for the whole API, replacing the old shared MASTER_API_KEY.
 *
 * Every endpoint here exposes guest PII (names, phones, ID document numbers)
 * or moves a guest in and out of a room, so none of it may be open the way
 * the Apps Script's getPromos is. A logged-in user's session is a JWT (sent
 * as `x-api-key`, or as a bearer token so a browser fetch can use the
 * standard header), signed with AUTH_JWT_SECRET and carrying their id,
 * username, and role.
 */

export interface SessionUser {
  sub: string;
  username: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

const TOKEN_TTL = "12h"; // matches master/web's own session TTL (Code.gs's TOKEN_TTL_MS)

function secret(): string {
  const value = process.env.AUTH_JWT_SECRET;
  if (!value) {
    throw new Error("AUTH_JWT_SECRET is not set — see server/.env.example");
  }
  return value;
}

export function signSession(user: { id: string; username: string; role: UserRole }): string {
  const payload: SessionUser = { sub: user.id, username: user.username, role: user.role };
  return jwt.sign(payload, secret(), { expiresIn: TOKEN_TTL });
}

function suppliedToken(req: Request): string {
  const header = req.get("x-api-key");
  if (header) return header;

  const auth = req.get("authorization") ?? "";
  const [scheme, value] = auth.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : "";
}

// Exported so the login/verify routes can validate a token without
// duplicating the jwt.verify call, and so a bad AUTH_JWT_SECRET fails the
// same way (500, logged) everywhere rather than silently in one spot.
export function verifySession(token: string): SessionUser | null {
  try {
    return jwt.verify(token, secret()) as SessionUser;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Refuse to serve rather than fall open: an unset secret must never mean
  // "let everyone in", which is exactly how PII gets published by accident.
  if (!process.env.AUTH_JWT_SECRET) {
    console.error("AUTH_JWT_SECRET is not set — refusing all requests");
    res.status(503).json({ ok: false, error: "server is not configured for auth" });
    return;
  }

  const token = suppliedToken(req);
  const session = token ? verifySession(token) : null;
  if (!session) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  req.user = session;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== UserRole.Admin) {
    res.status(403).json({ ok: false, error: "admin only" });
    return;
  }
  next();
}

/**
 * Role gates for the two resource areas below Admin. Both let BOH through
 * read-only (view every tab, input nothing) rather than blocking it
 * entirely — the actual "cannot input anything" restriction is enforcing
 * GET-only, not hiding data. Housekeeping is the mirror image: write access,
 * but only within its one area, nothing in the front-desk area at all.
 */

// Reservations, cards, ID documents, TV push — the reception toolset.
// Housekeeping has no business here, not even to look.
export function requireFrontDeskArea(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === UserRole.Admin || role === UserRole.FrontDesk) return next();
  if (role === UserRole.BOH && req.method === "GET") return next();
  res.status(403).json({ ok: false, error: "forbidden" });
}

// Rooms / the housekeeping worksheet — the one area Housekeeping can write to.
export function requireRoomsArea(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === UserRole.Admin || role === UserRole.FrontDesk || role === UserRole.Housekeeping) return next();
  if (role === UserRole.BOH && req.method === "GET") return next();
  res.status(403).json({ ok: false, error: "forbidden" });
}
