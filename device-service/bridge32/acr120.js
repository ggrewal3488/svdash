"use strict";

const koffi = require("koffi");

// UNVERIFIED — ACS shipped several ACR120U.dll revisions over the years with
// signature drift between them, and this SDK has no header to confirm which
// one this is. The signatures below are ACS's most commonly published v3.x
// API (widely mirrored, but not confirmed against *this* binary). Every
// exported name is real (confirmed via the DLL's export table — see
// ../docs/VENDOR_SDK_FINDINGS.md); the parameter shapes are not. Run
// verify.js against real hardware before trusting anything here, and fix up
// whichever calls don't behave as expected — that's expected, not a bug in
// this file.
function loadAcr120(dllPath) {
  const lib = koffi.load(dllPath);

  const ACR120_RequestDLLVersion = lib.func(
    "bool __stdcall ACR120_RequestDLLVersion(uint8_t *pVersion)",
  );
  const ACR120_Open = lib.func("bool __stdcall ACR120_Open(int32 nSlotNo, uint8_t *pReaderName)");
  const ACR120_Close = lib.func("bool __stdcall ACR120_Close(int32 nSlotNo)");
  const ACR120_Reset = lib.func("bool __stdcall ACR120_Reset(int32 nSlotNo, uint8_t bReserved)");
  const ACR120_Status = lib.func("bool __stdcall ACR120_Status(int32 nSlotNo, uint8_t *pStatus)");
  // Mifare UID is 4 or 7 bytes depending on card type; callers pass a
  // 10-byte buffer to be safe and slice to what the reader actually filled.
  const ACR120_Select = lib.func("bool __stdcall ACR120_Select(int32 nSlotNo, uint8_t *pSerNum)");
  const ACR120_Login = lib.func(
    "bool __stdcall ACR120_Login(int32 nSlotNo, uint8_t bBlockNo, uint8_t bKeyType, uint8_t *pKey)",
  );
  // Mifare blocks are 16 bytes.
  const ACR120_Read = lib.func(
    "bool __stdcall ACR120_Read(int32 nSlotNo, uint8_t bBlockNo, uint8_t *pData)",
  );
  const ACR120_Write = lib.func(
    "bool __stdcall ACR120_Write(int32 nSlotNo, uint8_t bBlockNo, uint8_t *pData)",
  );
  const ACR120_ListTags = lib.func(
    "bool __stdcall ACR120_ListTags(int32 nSlotNo, uint8_t *pTagLength, uint8_t *pTagList)",
  );

  const BLOCK_SIZE = 16;
  const KEY_TYPE_A = 0xaa;
  const KEY_TYPE_B = 0xbb;

  return {
    KEY_TYPE_A,
    KEY_TYPE_B,

    getDllVersion() {
      const buf = Buffer.alloc(16);
      if (!ACR120_RequestDLLVersion(buf)) {
        throw new Error("ACR120: RequestDLLVersion failed");
      }
      return buf.toString("ascii").replace(/\0.*$/, "");
    },

    open(slot) {
      const nameBuf = Buffer.alloc(64);
      if (!ACR120_Open(slot, nameBuf)) {
        throw new Error(`ACR120: open failed at slot ${slot}`);
      }
      return nameBuf.toString("ascii").replace(/\0.*$/, "");
    },

    close(slot) {
      ACR120_Close(slot);
    },

    reset(slot) {
      if (!ACR120_Reset(slot, 0)) {
        throw new Error(`ACR120: reset failed at slot ${slot}`);
      }
    },

    status(slot) {
      const buf = Buffer.alloc(1);
      if (!ACR120_Status(slot, buf)) {
        throw new Error(`ACR120: status failed at slot ${slot}`);
      }
      return buf.readUInt8(0);
    },

    // Card must be presented on the reader. Returns the UID as a hex string.
    select(slot) {
      const buf = Buffer.alloc(10);
      if (!ACR120_Select(slot, buf)) {
        throw new Error(`ACR120: no card on slot ${slot}`);
      }
      return buf;
    },

    login(slot, block, keyType, key) {
      const keyBuf = Buffer.from(key);
      if (keyBuf.length !== 6) {
        throw new Error("ACR120: Mifare key must be 6 bytes");
      }
      if (!ACR120_Login(slot, block, keyType, keyBuf)) {
        throw new Error(`ACR120: login failed for block ${block}`);
      }
    },

    // Caller must select() and login() this block first.
    readBlock(slot, block) {
      const buf = Buffer.alloc(BLOCK_SIZE);
      if (!ACR120_Read(slot, block, buf)) {
        throw new Error(`ACR120: read failed for block ${block}`);
      }
      return buf;
    },

    // Caller must select() and login() this block first. Writing the wrong
    // block (esp. sector trailers, block 0) can brick the card.
    writeBlock(slot, block, data) {
      const buf = Buffer.from(data);
      if (buf.length !== BLOCK_SIZE) {
        throw new Error("ACR120: block data must be exactly 16 bytes");
      }
      if (!ACR120_Write(slot, block, buf)) {
        throw new Error(`ACR120: write failed for block ${block}`);
      }
    },

    listTags(slot) {
      const lengthBuf = Buffer.alloc(1);
      const listBuf = Buffer.alloc(255);
      if (!ACR120_ListTags(slot, lengthBuf, listBuf)) {
        throw new Error(`ACR120: list tags failed on slot ${slot}`);
      }
      return listBuf.subarray(0, lengthBuf.readUInt8(0));
    },
  };
}

module.exports = { loadAcr120 };
