import { Router } from "express";
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { db } from "../db";
import { requireAdmin, requireAuth, signSession } from "../auth";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!username || !password) {
    res.status(400).json({ ok: false, error: "username and password are required" });
    return;
  }

  try {
    const user = await db.user.findUnique({ where: { username } });
    // Same error either way — don't tell a caller whether the username
    // exists, only whether the pair is valid.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ ok: false, error: "invalid username or password" });
      return;
    }
    res.json({ ok: true, token: signSession(user), username: user.username, role: user.role });
  } catch (err) {
    console.error("login failed:", err);
    res.status(500).json({ ok: false, error: "login failed" });
  }
});

// Lets the UI restore a session on page load without re-sending the
// password, and lets it check a token before trusting sessionStorage.
authRouter.get("/verify", requireAuth, (req, res) => {
  res.json({ ok: true, username: req.user!.username, role: req.user!.role });
});

authRouter.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await db.user.findMany({
      select: { id: true, username: true, role: true, createdAt: true },
      orderBy: { username: "asc" },
    });
    res.json({ ok: true, users });
  } catch (err) {
    console.error("list users failed:", err);
    res.status(500).json({ ok: false, error: "list users failed" });
  }
});

authRouter.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const role = req.body?.role;

  if (!username || password.length < 8) {
    res.status(400).json({ ok: false, error: "username is required and password must be at least 8 characters" });
    return;
  }
  if (!Object.values(UserRole).includes(role)) {
    res.status(400).json({ ok: false, error: `role must be one of: ${Object.values(UserRole).join(", ")}` });
    return;
  }

  try {
    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      res.status(409).json({ ok: false, error: "username is already taken" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({ data: { username, passwordHash, role } });
    res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt } });
  } catch (err) {
    console.error("create user failed:", err);
    res.status(500).json({ ok: false, error: "create user failed" });
  }
});
