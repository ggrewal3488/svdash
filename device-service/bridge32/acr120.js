"use strict";

const koffi = require("koffi");

// CONFIRMED against ACS's official "ACR120U Application Programming
// Interface" manual v3.00
// (https://www.acs.com.hk/download-manual/428/API_ACR120U_v3.00.pdf),
// sourced 2026-08-22 after black-box guessing crashed on a wrong parameter
// count. Its Appendix C lists USB VID_0x072F/PID_0x8003 for the ACR120U —
// an exact match for this hardware's real Device Manager entry, confirming
// it's the right document for this exact reader, not just a same-family
// guess.
//
// The real API turned out to be nothing like the earlier guesses: every
// function returns INT16 (0 = success, negative = an error code — not a
// bool), ACR120_Open returns a *handle* that every other call must be
// given (not the raw port number echoed back), and several functions take
// more output pointers than assumed (Select takes 4 params, ListTags takes
// 5, RequestDLLVersion takes 2, Login takes a Sector + an unused StoredNo
// slot). This module keeps the same call shape its callers (server.js,
// dumpCard.js) already use — select(port), login(port, block, ...), etc.
// — and handles the real Open/handle dance internally: the first call
// opens the reader once (trying each plausible ACR120_USBn value, since
// the manual never gives their literal numbers — only defined in the
// vendor's acr120.h, which isn't in this SDK) and caches the handle for
// every call after.
function loadAcr120(dllPath) {
  const lib = koffi.load(dllPath);

  const Open = lib.func("int16 __stdcall ACR120_Open(int16 ReaderPort)");
  const Close = lib.func("int16 __stdcall ACR120_Close(int16 hReader)");
  const RequestDLLVersion = lib.func(
    "int16 __stdcall ACR120_RequestDLLVersion(uint8_t *pVersionInfoLength, uint8_t *pVersionInfo)",
  );
  const Select = lib.func(
    "int16 __stdcall ACR120_Select(int16 hReader, uint8_t *pResultTagType, uint8_t *pResultTagLength, uint8_t *pResultSN)",
  );
  const Login = lib.func(
    "int16 __stdcall ACR120_Login(int16 hReader, uint8_t Sector, uint8_t KeyType, int8_t StoredNo, uint8_t *pKey)",
  );
  const Read = lib.func("int16 __stdcall ACR120_Read(int16 hReader, uint8_t Block, uint8_t *pBlockData)");
  const Write = lib.func("int16 __stdcall ACR120_Write(int16 hReader, uint8_t Block, uint8_t *pBlockData)");
  const ListTags = lib.func(
    "int16 __stdcall ACR120_ListTags(int16 hReader, uint8_t *pNumTagFound, uint8_t *pTagType, uint8_t *pTagLength, uint8_t *pSN)",
  );

  const BLOCK_SIZE = 16;
  const KEY_TYPE_A = 0xaa;
  const KEY_TYPE_B = 0xbb;
  const SUCCESS = 0;

  // Only one physical reader is ever attached in this deployment, so a
  // single cached handle (not one per requested "port") is enough — every
  // caller passes port 0 today anyway. 1 is tried first since the manual
  // names these "ACR120_USB1".."ACR120_USB8", suggesting 1-based values.
  const PORT_CANDIDATES = [1, 0, 2, 3, 4, 5, 6, 7, 8];
  let hReader = null;

  function ensureOpen() {
    if (hReader !== null) return hReader;
    for (const candidate of PORT_CANDIDATES) {
      const result = Open(candidate);
      if (result > 0) {
        hReader = result;
        return hReader;
      }
    }
    throw new Error(`ACR120: could not open the reader (tried ports ${PORT_CANDIDATES.join(", ")})`);
  }

  function check(label, result) {
    if (result !== SUCCESS) {
      throw new Error(`ACR120: ${label} failed (code ${result})`);
    }
  }

  return {
    KEY_TYPE_A,
    KEY_TYPE_B,

    getDllVersion() {
      const lenBuf = Buffer.alloc(1);
      const verBuf = Buffer.alloc(64);
      check("RequestDLLVersion", RequestDLLVersion(lenBuf, verBuf));
      return verBuf.subarray(0, lenBuf.readUInt8(0)).toString("ascii");
    },

    // `_port` kept for call-site compatibility with the rest of this
    // module — see the single-reader note above.
    open(_port) {
      return ensureOpen();
    },

    close(_port) {
      if (hReader === null) return;
      Close(hReader);
      hReader = null;
    },

    // Card must be presented on the reader. Returns the UID as a Buffer.
    select(_port) {
      const h = ensureOpen();
      const typeBuf = Buffer.alloc(1);
      const lenBuf = Buffer.alloc(1);
      const snBuf = Buffer.alloc(10);
      check("Select", Select(h, typeBuf, lenBuf, snBuf));
      return snBuf.subarray(0, lenBuf.readUInt8(0));
    },

    // `block` matches every other method here (a Mifare block number, not
    // a sector) — the real ACR120_Login authenticates a whole sector at
    // once, so this derives the sector the same way Mifare 1K addressing
    // always does (sector = block / 4) rather than changing what callers
    // pass in.
    login(_port, block, keyType, key) {
      const keyBuf = Buffer.from(key);
      if (keyBuf.length !== 6) {
        throw new Error("ACR120: Mifare key must be 6 bytes");
      }
      const h = ensureOpen();
      const sector = Math.floor(block / 4);
      check("Login", Login(h, sector, keyType, 0, keyBuf));
    },

    // Caller must select() and login() this block's sector first.
    readBlock(_port, block) {
      const h = ensureOpen();
      const buf = Buffer.alloc(BLOCK_SIZE);
      check("Read", Read(h, block, buf));
      return buf;
    },

    // Caller must select() and login() this block's sector first. Writing
    // the wrong block (esp. sector trailers, block 0) can brick the card.
    writeBlock(_port, block, data) {
      const buf = Buffer.from(data);
      if (buf.length !== BLOCK_SIZE) {
        throw new Error("ACR120: block data must be exactly 16 bytes");
      }
      const h = ensureOpen();
      check("Write", Write(h, block, buf));
    },

    listTags(_port) {
      const h = ensureOpen();
      const countBuf = Buffer.alloc(1);
      const typeBuf = Buffer.alloc(4);
      const lenBuf = Buffer.alloc(4);
      const snBuf = Buffer.alloc(40); // 4 tags x 10 bytes, per the manual
      check("ListTags", ListTags(h, countBuf, typeBuf, lenBuf, snBuf));
      return snBuf.subarray(0, countBuf.readUInt8(0) * 10);
    },
  };
}

module.exports = { loadAcr120 };
