import "dotenv/config";
import express from "express";
import { join } from "path";
import { requireAuth } from "./auth";
import { startSyncScheduler } from "./scheduler";
import { authRouter } from "./routes/auth";
import { reservationsRouter } from "./routes/reservations";
import { roomsRouter } from "./routes/rooms";
import { cardsRouter } from "./routes/cards";
import { idDocumentsRouter } from "./routes/idDocuments";
import { tvRouter } from "./routes/tv";

const app = express();
app.use(express.json());

// Unauthenticated: a health probe carries nothing, and the front-desk page is
// an empty shell until its JavaScript authenticates with a login of its own.
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/", express.static(join(__dirname, "..", "public")));

// /auth/login is intentionally public (that's the point); /auth/verify and
// the users endpoints gate themselves per-route in routes/auth.ts.
app.use("/auth", authRouter);

// Everything past here touches guest PII or moves guests between rooms.
app.use("/reservations", requireAuth, reservationsRouter);
app.use("/rooms", requireAuth, roomsRouter);
app.use("/cards", requireAuth, cardsRouter);
app.use("/id-documents", requireAuth, idDocumentsRouter);
app.use("/tv", requireAuth, tvRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => {
  console.log(`master-api listening on :${port}`);
  startSyncScheduler();
});
