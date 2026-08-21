# Vendor SDK findings (Godrej btlock v5.7 install)

Source: the `Godrej V5.7` install directory (btlock57.exe + drivers), inspected
2026-08-21. This documents what's actually verifiable from the binaries
themselves, so later work doesn't re-derive it or, worse, assume more than we
know.

## The two DLLs that matter

Godrej's btlock app is a database/UI shell (`btlock57.mdb`, `tabstruc.sql`,
`patchdb.sql`) wrapped around two off-the-shelf hardware SDKs. Neither DLL is
Godrej's own code — both are the vendor chips' stock SDKs, which is good news:
their APIs are publicly documented outside this install.

### `CH375DLL.DLL` (RD-Z08 lock programmer, `Drivers/RD-Z08/`)
WCH's generic USB-to-parallel/generic bus chip. Confirmed by export table
(`objdump -p`) to be the standard, unmodified WCH `CH375DLL.H` API — every
name matches WCH's public SDK exactly (`CH375OpenDevice`, `CH375ReadData`,
`CH375WriteData`, `CH375WriteRead`, `CH375ResetDevice`, `CH375SetTimeout`,
etc. — 32 exports total, see below). This chip is the USB bridge the RD-Z08
box uses to talk to whatever's plugged into it; it does raw byte I/O, nothing
lock-specific.

### `ACR120U.dll` / `AcsReader.dll` (RW-41 card encoder, `Drivers/RW-41(ACR120)/`)
Advanced Card Systems' ACR120 Mifare reader/writer. Export table confirms
standard ACR120U names (`ACR120_Open`, `ACR120_Select`, `ACR120_Login`,
`ACR120_Read`, `ACR120_Write`, `ACR120_ListTags`, `ACR120_RequestDLLVersion`,
plus PICC_* ISO14443-4 calls). `AcsReader.dll` in the install root wraps the
same chip family under a different naming scheme (`acr_120*`, `acr_38*`,
`acr_s4442*`) — looks like an older/alternate ACS reader (ACR38/S4442
contact chip cards), present but not what RW-41 uses.

## Verified exports

Extracted directly from the binaries with `objdump -p` (PE export table) —
these names are exact, not guessed:

**CH375DLL.DLL**: CH375AbortInter, CH375AbortRead, CH375AbortWrite,
CH375CloseDevice, CH375DriverCommand, CH375GetConfigDescr,
CH375GetDeviceDescr, CH375GetDeviceName, CH375GetDrvVersion, CH375GetStatus,
CH375GetUsbID, CH375GetVersion, CH375OpenDevice, CH375QueryBufDownload,
CH375QueryBufUpload, CH375ReadData, CH375ReadInter, CH375ResetAux,
CH375ResetDevice, CH375ResetInter, CH375ResetRead, CH375ResetWrite,
CH375SetBufDownload, CH375SetBufUpload, CH375SetDeviceNotify,
CH375SetExclusive, CH375SetIntRoutine, CH375SetTimeout, CH375SetTimeoutEx,
CH375WriteAuxData, CH375WriteData, CH375WriteRead

**ACR120U.dll**: ACR120_Close, ACR120_Copy, ACR120_Dec, ACR120_DirectReceive,
ACR120_DirectSend, ACR120_Inc, ACR120_ListTags, ACR120_Login,
ACR120_MultiTagSelect, ACR120_Open, ACR120_Power, ACR120_Read,
ACR120_ReadATQB, ACR120_ReadEEPROM, ACR120_ReadRC500Reg, ACR120_ReadUserPort,
ACR120_ReadValue, ACR120_RequestDLLVersion, ACR120_Reset, ACR120_Select,
ACR120_Status, ACR120_TxDataTelegram, ACR120_Write, ACR120_WriteEEPROM,
ACR120_WriteMasterKey, ACR120_WriteRC500Reg, ACR120_WriteUserPort,
ACR120_WriteValue, PICC_Deselect, PICC_InitBlockNumber, PICC_RATS,
PICC_Xch_APDU

## What's confirmed vs. what's still open

**Confirmed, and now hardware-tested (2026-08-21, real RD-08E lock
programmer over SSH into the front-desk PC)** — the CH375 call signatures in
`bridge32/ch375.js` work against real hardware, not just against a
plausible-looking public API: `CH375GetVersion`/`CH375GetDrvVersion` return
real values, and `CH375OpenDevice(0)` returns a real device handle (`840`)
rather than the `0xFFFFFFFF` failure sentinel. `verify.js` passes cleanly
end to end for this device.

**Still not confirmed — exact ACR120U parameter marshaling.** ACS shipped
several DLL revisions over the years (16-bit `ACR120.dll`, several
`ACR120U.dll` majors) with signature drift between them, and this install
has no header file to pin down which one this is. Tested live against the
real RW-41 reader (2026-08-21/22, confirmed present and healthy in Device
Manager throughout) through ~25 parameter/calling-convention variants
across `ACR120_Open`, `ACR120_RequestDLLVersion`, and `ACR120_Select`:

- `ACR120_Open(int32 nSlotNo) -> bool` failed 12/13 attempts across two
  separate sessions (including 8 in a row with delays between retries — not
  a timing issue). The one "success" (`Open(1) -> true`) never reproduced
  and is confirmed noise, not a real signal — not carried into `acr120.js`.
- `ACR120_Select(int32 nSlotNo, uint8_t *pSerNum) -> bool` crashed the
  Node process outright on first attempt (zero output, immediate death) —
  a real ABI mismatch, not just a wrong return value. A follow-up attempt
  with a much larger output buffer (256 bytes vs. the original 16, to rule
  out a buffer-overflow-triggered crash) was gated behind `Open` actually
  succeeding first, which it never did, so `Select` was never safely
  re-attempted. Whether the larger buffer would have avoided the crash is
  still unknown.
- `ACR120_RequestDLLVersion` — every variant returns cleanly (no crash) but
  with a value that doesn't look like a real DLL version, across both
  buffer and no-buffer variants.

`bridge32/acr120.js` still declares the signatures from ACS's most commonly
published v3.x API manual, still flagged `UNVERIFIED`. Black-box probing
without documentation has hit its practical ceiling here — one confirmed
crash and no reproducible success across ~25 variants and two sessions is a
real signal to stop guessing, not just bad luck. Next step is sourcing
ACS's actual "API Reference Manual for ACR120" rather than continuing to
guess at signatures with demonstrated crash risk.

**Unknown and NOT in this SDK at all** — the actual room-card data format.
Reading/writing raw Mifare blocks via `ACR120_Read`/`ACR120_Write` is now
possible in principle, but *what bytes make a card open a Godrej lock*
(which sector, which key, how room number / expiry / holder are packed into
the block) is proprietary logic baked into `btlock57.exe`'s compiled code —
it isn't exposed by the DLL, isn't in `tabstruc.sql` (that only has the
*business* schema: `issuedcards`, `doors`, `cardsector` — no byte layout),
and reverse-engineering the exe is out of scope here. See
`src/cardLayout.ts` for the plan to derive this empirically instead of
guessing it.

## Architecture consequence: both DLLs are 32-bit

`file` confirms both are `PE32 ... Intel 80386` — 32-bit only. Modern Node.js
on Windows ships x64/arm64; a 64-bit process cannot `LoadLibrary` a 32-bit
DLL. That's why this is two packages, not one: `bridge32/` is a 32-bit Node
process that talks to the hardware directly, and `device-service/` (the
64-bit control API, matching the rest of this repo's stack) talks to
`bridge32` over localhost HTTP rather than loading the DLLs itself. See the
top-level `device-service/README.md` for the full picture.
