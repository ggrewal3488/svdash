import "dotenv/config";
import express from "express";
import { reservationsRouter } from "./routes/reservations";
import { roomsRouter } from "./routes/rooms";
import { cardsRouter } from "./routes/cards";

const app = express();
app.use(express.json());

app.use("/reservations", reservationsRouter);
app.use("/rooms", roomsRouter);
app.use("/cards", cardsRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => {
  console.log(`master-api listening on :${port}`);
});
