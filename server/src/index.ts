import "dotenv/config";
import express from "express";
import { join } from "path";
import { requireApiKey } from "./auth";
import { startSyncScheduler } from "./scheduler";
import { reservationsRouter } from "./routes/reservations";
import { roomsRouter } from "./routes/rooms";
import { cardsRouter } from "./routes/cards";
import { idDocumentsRouter } from "./routes/idDocuments";

const app = express();
app.use(express.json());

// Unauthenticated: a health probe carries nothing, and the front-desk page is
// an empty shell until its JavaScript authenticates with a key of its own.
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/", express.static(join(__dirname, "..", "public")));

// Lets the UI check a key before storing it, without exposing any data.
app.post("/auth/verify", requireApiKey, (_req, res) => res.json({ ok: true }));

// Everything past here touches guest PII or moves guests between rooms.
app.use("/reservations", requireApiKey, reservationsRouter);
app.use("/rooms", requireApiKey, roomsRouter);
app.use("/cards", requireApiKey, cardsRouter);
app.use("/id-documents", requireApiKey, idDocumentsRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => {
  console.log(`master-api listening on :${port}`);
  startSyncScheduler();
});
