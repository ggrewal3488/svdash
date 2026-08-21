import "dotenv/config";
import express from "express";
import { reservationsRouter } from "./routes/reservations";

const app = express();
app.use(express.json());

app.use("/reservations", reservationsRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => {
  console.log(`master-api listening on :${port}`);
});
