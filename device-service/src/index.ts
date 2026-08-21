import "dotenv/config";
import express from "express";
import { bridge32 } from "./bridge32Client";
import { encodeGuestCard } from "./cardLayout";
import { requireApiKey } from "./auth";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Everything past here can trigger a physical card write or report on
// hardware state, so it's gated the same way master-api gates guest PII.
app.use(requireApiKey);

// Proxies through to bridge32 (the 32-bit process with actual hardware
// access — see bridge32/ and docs/VENDOR_SDK_FINDINGS.md) so the rest of
// this repo's stack, including the master-api Application API, only ever
// has to talk to a normal 64-bit HTTP service.
app.get("/bridge/health", async (_req, res) => {
  try {
    res.json(await bridge32.health());
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/bridge/versions", async (_req, res) => {
  try {
    const [acr120, ch375] = await Promise.all([bridge32.acr120Version(), bridge32.ch375Version()]);
    res.json({ ok: true, acr120, ch375 });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message });
  }
});

// Deliberately 501s until cardLayout.ts has a real byte layout (see that
// file for why it doesn't yet) — this route exists now so master-api can
// wire against a stable contract, and start actually encoding cards the
// moment cardLayout.ts is filled in, with no callers needing a code change.
app.post("/cards/encode", (req, res) => {
  const roomNumber = String(req.body?.roomNumber ?? "").trim();
  const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
  if (!roomNumber || !expiresAt || Number.isNaN(expiresAt.getTime())) {
    res.status(400).json({ ok: false, error: "roomNumber and a valid expiresAt are required" });
    return;
  }

  try {
    encodeGuestCard({ roomNumber, expiresAt });
    res.json({ ok: true });
  } catch (err) {
    res.status(501).json({ ok: false, error: (err as Error).message });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 8092;
app.listen(port, () => {
  console.log(`device-service listening on :${port}`);
});
