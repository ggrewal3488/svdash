"use strict";

const koffi = require("koffi");

// WCH's public CH375DLL.H API — these signatures are stable and have been
// publicly documented for 15+ years; confidence here is real, not a guess.
// This wires up the read/write/reset subset the RD-Z08 lock programmer
// actually needs. The interrupt-transfer and internal-buffer exports
// (CH375*Inter, CH375*Buf*) aren't included because nothing here uses them —
// see ../docs/VENDOR_SDK_FINDINGS.md for the full export list.
function loadCh375(dllPath) {
  const lib = koffi.load(dllPath);

  const CH375GetVersion = lib.func("uint32 __stdcall CH375GetVersion()");
  const CH375GetDrvVersion = lib.func("uint32 __stdcall CH375GetDrvVersion()");
  const CH375OpenDevice = lib.func("uint32 __stdcall CH375OpenDevice(uint32 iIndex)");
  const CH375CloseDevice = lib.func("void __stdcall CH375CloseDevice(uint32 iIndex)");
  const CH375ResetDevice = lib.func("bool __stdcall CH375ResetDevice(uint32 iIndex)");
  const CH375SetTimeout = lib.func(
    "bool __stdcall CH375SetTimeout(uint32 iIndex, uint32 iWriteTimeout, uint32 iReadTimeout)",
  );
  // ioLength is in/out: caller sets the buffer capacity in, the DLL writes
  // the actual byte count transferred back. koffi passes Node Buffers as
  // real pointers for `*` params, so both go in/out as plain 4-byte buffers.
  const CH375ReadData = lib.func(
    "bool __stdcall CH375ReadData(uint32 iIndex, uint8_t *oBuffer, uint32 *ioLength)",
  );
  const CH375WriteData = lib.func(
    "bool __stdcall CH375WriteData(uint32 iIndex, uint8_t *iBuffer, uint32 *ioLength)",
  );

  // CH375OpenDevice returns 0xFFFFFFFF (per WCH's doc) on failure, anything
  // else is a valid device index handle.
  const DEVICE_NOT_FOUND = 0xffffffff;

  return {
    getVersion: () => CH375GetVersion(),
    getDrvVersion: () => CH375GetDrvVersion(),

    open(index) {
      const result = CH375OpenDevice(index);
      if (result === DEVICE_NOT_FOUND) {
        throw new Error(`CH375: no device at index ${index}`);
      }
      return result;
    },

    close(index) {
      CH375CloseDevice(index);
    },

    reset(index) {
      if (!CH375ResetDevice(index)) {
        throw new Error(`CH375: reset failed at index ${index}`);
      }
    },

    setTimeout(index, writeMs, readMs) {
      if (!CH375SetTimeout(index, writeMs, readMs)) {
        throw new Error(`CH375: set timeout failed at index ${index}`);
      }
    },

    read(index, maxLength) {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(maxLength, 0);
      const outBuf = Buffer.alloc(maxLength);
      if (!CH375ReadData(index, outBuf, lenBuf)) {
        throw new Error(`CH375: read failed at index ${index}`);
      }
      return outBuf.subarray(0, lenBuf.readUInt32LE(0));
    },

    write(index, data) {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(data.length, 0);
      const inBuf = Buffer.from(data);
      if (!CH375WriteData(index, inBuf, lenBuf)) {
        throw new Error(`CH375: write failed at index ${index}`);
      }
      return lenBuf.readUInt32LE(0);
    },
  };
}

module.exports = { loadCh375 };
