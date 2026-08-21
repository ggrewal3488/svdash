"use strict";

// Run this FIRST on the actual front-desk Windows PC, with both devices
// plugged in, before building anything on top of the bridge. It doesn't
// program anything — it just proves the DLLs load under this Node build and
// reports back real values, so the ACR120 signatures in acr120.js (marked
// UNVERIFIED) can be checked by eye against what ACR120_RequestDLLVersion /
// ACR120_Open / ACR120_ListTags actually return.
//
// Usage: node verify.js

const { CH375_DLL_PATH, ACR120_DLL_PATH } = require("./config");
const { loadCh375 } = require("./ch375");
const { loadAcr120 } = require("./acr120");

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function tryStep(label, fn) {
  try {
    const result = fn();
    console.log(`  OK  ${label}${result !== undefined ? ": " + result : ""}`);
    return result;
  } catch (err) {
    console.log(`  FAIL ${label}: ${err.message}`);
    return undefined;
  }
}

section("Process architecture");
console.log(`  process.arch = ${process.arch} (must be "ia32" — the vendor DLLs are 32-bit)`);
if (process.arch !== "ia32") {
  console.log("  This process is not 32-bit. Run with a 32-bit Node build, e.g. an ia32 nvm-windows install.");
  process.exit(1);
}

section("CH375DLL.DLL (RD-Z08 lock programmer)");
tryStep(`load ${CH375_DLL_PATH}`, () => {
  const ch375 = loadCh375(CH375_DLL_PATH);
  tryStep("CH375GetDrvVersion", () => ch375.getDrvVersion());
  tryStep("CH375GetVersion", () => ch375.getVersion());
  tryStep("open device 0", () => ch375.open(0));
  ch375.close(0);
});

section("ACR120U.dll (RW-41 card encoder)");
tryStep(`load ${ACR120_DLL_PATH}`, () => {
  const acr120 = loadAcr120(ACR120_DLL_PATH);
  tryStep("ACR120_RequestDLLVersion", () => acr120.getDllVersion());
  const readerName = tryStep("ACR120_Open(slot 0)", () => acr120.open(0));
  if (readerName !== undefined) {
    tryStep("ACR120_ListTags — present a card now", () => acr120.listTags(0).toString("hex"));
    acr120.close(0);
  }
});

console.log("\nDone. Any FAIL above on ACR120 calls means that function's signature in");
console.log("acr120.js needs fixing before relying on it — that's the expected first pass.");
