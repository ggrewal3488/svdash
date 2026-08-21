import "dotenv/config";
import express from "express";
import { bridge32 } from "./bridge32Client";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

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

// There is no /cards/encode route yet — see src/cardLayout.ts for why.
// Encoding a guest's card requires knowing Godrej's byte layout, which
// isn't in the SDK and has to be derived from real hardware first.

const port = process.env.PORT ? Number(process.env.PORT) : 8092;
app.listen(port, () => {
  console.log(`device-service listening on :${port}`);
});
