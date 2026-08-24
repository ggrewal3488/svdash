"use strict";

// One-off validation tool for the cardLayout.ts derivation (step 4: "a
// hand-written card actually opens the real lock"). Takes a known-good
// dump (from dumpCard.js), patches specific byte offsets within one block,
// and writes the result back to whatever card is on the reader right now —
// leaving every other byte, including any checksum/counter bytes we don't
// yet understand, exactly as they were on the source card. That isolates
// the test to exactly one question: do the room/date bytes we identified
// actually drive what the physical lock accepts, or does something else
// (an unrecognized checksum, etc.) also have to change?
//
// Deliberately restricted to sector 0/1/2's data blocks (1, 2, 5, 6, 9, 10)
// — never block 0 (manufacturer block) or any sector trailer (block % 4
// == 3, holds the keys) — writing either can brick the card.
//
// Usage:
//   node patchBlock.js <sourceDumpLabel> <block> <offset>=<hex>[,<offset>=<hex>...] [outLabel]
//   e.g. node patchBlock.js card1-r405-co25 1 13=06 card1-patched-as-406
//
// Prints old vs new block content and waits for the card before writing —
// nothing is written until you confirm the card is in place and hit Enter.

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { ACR120_DLL_PATH } = require("./config");
const { loadAcr120 } = require("./acr120");

const GODREJ_KEY = Buffer.from("1ab23cd45ef6", "hex");

function loadDump(label) {
  const file = path.join(__dirname, "dumps", `${label}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parsePatches(spec) {
  const patches = {};
  for (const part of spec.split(",")) {
    const [offsetStr, hex] = part.split("=");
    const offset = Number(offsetStr);
    if (!Number.isInteger(offset) || offset < 0 || offset > 15) {
      throw new Error(`bad byte offset: ${offsetStr}`);
    }
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
      throw new Error(`bad hex byte for offset ${offset}: ${hex} (want 2 hex digits)`);
    }
    patches[offset] = hex.toLowerCase();
  }
  return patches;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  const [sourceLabel, blockArg, patchSpec, outLabel] = process.argv.slice(2);
  if (!sourceLabel || !blockArg || !patchSpec) {
    console.error("Usage: node patchBlock.js <sourceDumpLabel> <block> <offset>=<hex>[,...] [outLabel]");
    process.exit(1);
  }

  const block = Number(blockArg);
  if (block === 0 || block % 4 === 3) {
    console.error(`Refusing to write block ${block} — manufacturer block or sector trailer, can brick the card.`);
    process.exit(1);
  }

  const dump = loadDump(sourceLabel);
  const entry = dump.blocks[block];
  if (!entry || !entry.data) {
    console.error(`Source dump has no readable data for block ${block} (locked or missing).`);
    process.exit(1);
  }

  const patches = parsePatches(patchSpec);
  const original = Buffer.from(entry.data, "hex");
  const patched = Buffer.from(original);
  for (const [offset, hex] of Object.entries(patches)) {
    patched[Number(offset)] = parseInt(hex, 16);
  }

  console.log(`Source: ${sourceLabel}, block ${block} (sector ${Math.floor(block / 4)})`);
  console.log(`  original: ${original.toString("hex")}`);
  console.log(`  patched:  ${patched.toString("hex")}`);
  console.log(`  changes:  ${Object.entries(patches).map(([o, h]) => `byte[${o}] ${original.toString("hex").slice(o * 2, o * 2 + 2)} -> ${h}`).join(", ")}`);

  const answer = await prompt("\nPlace the TARGET card on the RW-41 reader, then type YES to write: ");
  if (answer.trim() !== "YES") {
    console.log("Aborted — nothing written.");
    return;
  }

  const acr120 = loadAcr120(ACR120_DLL_PATH);
  const uid = acr120.select(0);
  console.log(`Card present, UID = ${uid.toString("hex")}`);
  acr120.login(0, block, acr120.KEY_TYPE_A, GODREJ_KEY);
  acr120.writeBlock(0, block, patched);
  console.log(`Wrote block ${block}.`);

  const readBack = acr120.readBlock(0, block);
  acr120.close(0);
  console.log(`Read back: ${readBack.toString("hex")}`);
  console.log(readBack.equals(patched) ? "Write confirmed — matches intended patch." : "WARNING: read-back does not match what we wrote.");

  if (outLabel) {
    const outDump = {
      label: outLabel,
      capturedAt: new Date().toISOString(),
      uid: uid.toString("hex"),
      blocks: { ...dump.blocks, [block]: { data: readBack.toString("hex"), key: "1ab23cd45ef6", keyType: "A" } },
    };
    const outPath = path.join(__dirname, "dumps", `${outLabel}.json`);
    fs.writeFileSync(outPath, JSON.stringify(outDump, null, 2));
    console.log(`Wrote dump record ${outPath}`);
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
