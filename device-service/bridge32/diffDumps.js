"use strict";

// Step 3 of the cardLayout.ts derivation plan: diff two dumpCard.js outputs
// (two test cards, encoded for different rooms/expiries via the real
// btlock57.exe) and report which blocks/bytes differ. Bytes that differ
// across cards are where room number / expiry / holder data lives; bytes
// that match on every block are fixed header/config bytes Godrej writes to
// every card the same way.
//
// This is a pure diff over JSON dumps — no DLL involved, runs under any
// Node (64-bit is fine).
//
// Usage: node diffDumps.js <dumpA.json> <dumpB.json> [dumpC.json ...]
//   With 2+ dumps, only blocks that differ somewhere across all of them are
//   printed (blocks identical across every dump are fixed bytes, and are
//   summarized, not printed in full).

const fs = require("fs");
const path = require("path");

function loadDump(file) {
  const resolved = path.isAbsolute(file) ? file : path.join(__dirname, "dumps", file);
  const withExt = resolved.endsWith(".json") ? resolved : `${resolved}.json`;
  return JSON.parse(fs.readFileSync(withExt, "utf8"));
}

function diffHexStrings(hexes) {
  // hexes: array of same-length hex strings (or undefined for missing/locked).
  // Returns per-byte-index list of distinct values seen, only for indices
  // where they're not all equal.
  const present = hexes.filter(Boolean);
  if (present.length < 2) return [];
  const byteCount = present[0].length / 2;
  const diffs = [];
  for (let i = 0; i < byteCount; i++) {
    const values = hexes.map((h) => (h ? h.slice(i * 2, i * 2 + 2) : "--"));
    if (new Set(values.filter((v) => v !== "--")).size > 1) {
      diffs.push({ byteIndex: i, values });
    }
  }
  return diffs;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length < 2) {
    console.error("Usage: node diffDumps.js <dumpA.json> <dumpB.json> [dumpC.json ...]");
    process.exit(1);
  }

  const dumps = files.map(loadDump);
  console.log(`Comparing ${dumps.length} dumps: ${dumps.map((d) => d.label).join(", ")}`);
  if (new Set(dumps.map((d) => d.uid)).size === 1) {
    console.log("WARNING: all dumps have the same card UID — did you dump the same physical card twice?");
  }

  const allBlockNos = new Set();
  for (const d of dumps) {
    for (const b of Object.keys(d.blocks)) allBlockNos.add(Number(b));
  }

  let identicalCount = 0;
  let lockedCount = 0;

  for (const blockNo of [...allBlockNos].sort((a, b) => a - b)) {
    const entries = dumps.map((d) => d.blocks[blockNo]);
    if (entries.some((e) => !e || e.locked || e.error)) {
      lockedCount++;
      continue;
    }
    const hexes = entries.map((e) => e.data);
    if (new Set(hexes).size === 1) {
      identicalCount++;
      continue;
    }
    const diffs = diffHexStrings(hexes);
    console.log(`\nblock ${blockNo} (sector ${Math.floor(blockNo / 4)}) differs:`);
    for (const [i, d] of dumps.entries()) {
      console.log(`  ${d.label.padEnd(20)} ${hexes[i]}`);
    }
    console.log(`  differing byte offsets: ${diffs.map((d) => d.byteIndex).join(", ")}`);
    for (const d of diffs) {
      console.log(`    byte[${d.byteIndex}]: ${d.values.join(" / ")}`);
    }
  }

  console.log(
    `\n${identicalCount} block(s) identical across all dumps, ${lockedCount} block(s) locked/unreadable in at least one dump.`,
  );
}

main();
