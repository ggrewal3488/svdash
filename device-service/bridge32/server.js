"use strict";

const express = require("express");
const { CH375_DLL_PATH, ACR120_DLL_PATH, PORT } = require("./config");
const { loadCh375 } = require("./ch375");
const { loadAcr120 } = require("./acr120");

const app = express();
app.use(express.json());

// Loaded lazily so /health works even if a DLL path is wrong or a device
// isn't plugged in yet — this process's job is to report that clearly, not
// crash the whole bridge over one missing reader.
let ch375 = null;
let acr120 = null;

function getCh375() {
  if (!ch375) ch375 = loadCh375(CH375_DLL_PATH);
  return ch375;
}

function getAcr120() {
  if (!acr120) acr120 = loadAcr120(ACR120_DLL_PATH);
  return acr120;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, arch: process.arch });
});

// Raw hardware primitives only — no Godrej card-format logic lives here.
// device-service (the 64-bit control API) composes these into actual guest
// card operations once that format is known; see ../docs/cardLayout.

app.post("/acr120/select", (req, res) => {
  const slot = Number(req.body?.slot ?? 0);
  try {
    const uid = getAcr120().select(slot);
    res.json({ ok: true, uid: uid.toString("hex") });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

app.post("/acr120/read-block", (req, res) => {
  const slot = Number(req.body?.slot ?? 0);
  const block = Number(req.body?.block);
  const keyType = req.body?.keyType === "B" ? getAcr120().KEY_TYPE_B : getAcr120().KEY_TYPE_A;
  const key = Buffer.from(String(req.body?.key ?? "ffffffffffff"), "hex");
  try {
    const acr = getAcr120();
    acr.login(slot, block, keyType, key);
    const data = acr.readBlock(slot, block);
    res.json({ ok: true, block, data: data.toString("hex") });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

app.post("/acr120/write-block", (req, res) => {
  const slot = Number(req.body?.slot ?? 0);
  const block = Number(req.body?.block);
  const keyType = req.body?.keyType === "B" ? getAcr120().KEY_TYPE_B : getAcr120().KEY_TYPE_A;
  const key = Buffer.from(String(req.body?.key ?? "ffffffffffff"), "hex");
  const data = Buffer.from(String(req.body?.data ?? ""), "hex");
  try {
    const acr = getAcr120();
    acr.login(slot, block, keyType, key);
    acr.writeBlock(slot, block, data);
    res.json({ ok: true, block });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

app.get("/acr120/version", (_req, res) => {
  try {
    res.json({ ok: true, version: getAcr120().getDllVersion() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/ch375/version", (_req, res) => {
  try {
    const c = getCh375();
    res.json({ ok: true, drvVersion: c.getDrvVersion(), version: c.getVersion() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

if (process.arch !== "ia32") {
  console.error(`FATAL: this process is ${process.arch}, not ia32. The vendor DLLs are 32-bit`);
  console.error("and cannot load into a 64-bit Node process. Run this under a 32-bit Node build.");
  process.exit(1);
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`godrej-bridge32 listening on 127.0.0.1:${PORT} (arch=${process.arch})`);
});
