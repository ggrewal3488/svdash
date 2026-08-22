"use strict";

// Step 2 of the cardLayout.ts derivation plan, automated: walk every sector
// of a Mifare 1K card (16 sectors x 4 blocks = blocks 0..63), trying each
// well-known default key against both key types until one logs in, then
// read all 4 blocks in that sector. Godrej likely only rekeyed the sectors
// it actually uses for room data, so most sectors should still open with a
// factory-default key.
//
// Usage: node dumpCard.js <label>
//   e.g. node dumpCard.js room101-a   (first test card, see cardLayout.ts step 1)
//        node dumpCard.js room101-b   (second test card, different room/expiry)
// Writes dumps/<label>.json. Diff two dumps with diffDumps.js.
//
// Run this under 32-bit Node (same requirement as verify.js/server.js — the
// vendor DLL is 32-bit only).

const fs = require("fs");
const path = require("path");
const { ACR120_DLL_PATH } = require("./config");
const { loadAcr120 } = require("./acr120");

const SECTOR_COUNT = 16; // Mifare Classic 1K. Re-run with a wider walk if a
// dump comes back with a SAK/ATQA indicating 4K — not handled here, see the
// note in cardLayout.ts about deriving this on real hardware rather than
// guessing.
const BLOCKS_PER_SECTOR = 4;

// Widely published Mifare Classic default/well-known keys, worth trying in
// order before giving up on a sector. Not exhaustive — if a sector comes
// back LOCKED, it means Godrej rekeyed it, and cracking that key is out of
// scope here.
const CANDIDATE_KEYS = [
  "1ab23cd45ef6", // Godrej's real sector-0 Key A — captured 2026-08-22 via
  // API Monitor watching btlock57.exe's own ACR120_Login calls (see
  // docs/VENDOR_SDK_FINDINGS.md). Tried first since it's confirmed real,
  // not a guess.
  "ffffffffffff", // factory default
  "a0a1a2a3a4a5", // NFC Forum / MAD key A
  "d3f7d3f7d3f7", // NFC Forum / MAD key B
  "000000000000",
  "b0b1b2b3b4b5",
  "4d3a99c351dd",
  "1a982c7e459a",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function selectWithRetry(acr120, slot, attempts = 10, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      return acr120.select(slot);
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(delayMs);
    }
  }
}

// Tries every candidate key x key type against the sector's first block.
// A successful login authenticates the whole sector, not just that block.
function findSectorKey(acr120, slot, sector) {
  const firstBlock = sector * BLOCKS_PER_SECTOR;
  for (const keyHex of CANDIDATE_KEYS) {
    const key = Buffer.from(keyHex, "hex");
    for (const [label, keyType] of [
      ["A", acr120.KEY_TYPE_A],
      ["B", acr120.KEY_TYPE_B],
    ]) {
      try {
        acr120.login(slot, firstBlock, keyType, key);
        return { keyHex, keyType: label };
      } catch {
        // wrong key/type for this sector, keep trying
      }
    }
  }
  return null;
}

async function dumpCard(label) {
  const acr120 = loadAcr120(ACR120_DLL_PATH);
  const slot = 0;

  console.log("Place the test card on the RW-41 reader...");
  const uid = await selectWithRetry(acr120, slot);
  console.log(`Card present, UID = ${uid.toString("hex")}`);

  const blocks = {};
  for (let sector = 0; sector < SECTOR_COUNT; sector++) {
    const found = findSectorKey(acr120, slot, sector);
    if (!found) {
      console.log(`  sector ${sector}: LOCKED (no candidate key worked)`);
      for (let b = 0; b < BLOCKS_PER_SECTOR; b++) {
        blocks[sector * BLOCKS_PER_SECTOR + b] = { locked: true };
      }
      continue;
    }
    console.log(`  sector ${sector}: opened with key ${found.keyHex} (type ${found.keyType})`);
    for (let b = 0; b < BLOCKS_PER_SECTOR; b++) {
      const blockNo = sector * BLOCKS_PER_SECTOR + b;
      try {
        const data = acr120.readBlock(slot, blockNo);
        blocks[blockNo] = { data: data.toString("hex"), key: found.keyHex, keyType: found.keyType };
      } catch (err) {
        blocks[blockNo] = { error: err.message, key: found.keyHex, keyType: found.keyType };
      }
    }
  }

  acr120.close(slot);

  const dump = {
    label,
    capturedAt: new Date().toISOString(),
    uid: uid.toString("hex"),
    blocks,
  };

  const dumpsDir = path.join(__dirname, "dumps");
  fs.mkdirSync(dumpsDir, { recursive: true });
  const outPath = path.join(dumpsDir, `${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log(`\nWrote ${outPath}`);
}

const label = process.argv[2];
if (!label) {
  console.error("Usage: node dumpCard.js <label>");
  process.exit(1);
}

dumpCard(label).catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
