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

**CONFIRMED (2026-08-22)** — the real ACR120U parameter marshaling, sourced
from ACS's actual official manual: *"ACR120U Contactless Reader/Writer,
Application Programming Interface", v3.00*, PDF at
https://www.acs.com.hk/download-manual/428/API_ACR120U_v3.00.pdf. Its
Appendix C lists `VID_0x072F & PID_0x8003` for the ACR120U — an exact match
for this hardware's real Device Manager entry, confirming it's the right
document for this exact reader, not a same-family guess. `bridge32/acr120.js`
now implements the real signatures and is verified end to end against real
hardware: `ACR120_RequestDLLVersion` returns a real string
(`ACR120U DLL 1.5.1.2`), `ACR120_Open` returns a real handle, and
`ACR120_ListTags`/`ACR120_Select` read a real card's UID.

Why ~25 black-box variants and one crash never found this: the real API is
nothing like what a "same family" guess would produce.

- Every function returns `INT16` (`0` = success, negative = an error code)
  — **not** a `bool`. The old `bool __stdcall ACR120_Open(int32) `-style
  guesses were checking truthiness of a value that was never meant to be
  truthy in the first place, which explains both the false "success" noise
  and the mostly-clean "failures."
- `ACR120_Open(INT16 ReaderPort) -> INT16` returns a **handle** that every
  other function must be given — not the port number echoed back. The
  manual documents the port values only as symbolic
  (`ACR120_USB1`..`ACR120_USB8`, defined in `acr120.h`, which isn't in this
  SDK), so `acr120.js` tries each plausible value and caches whichever one
  actually opens.
- Several functions take more parameters than assumed:
  `ACR120_Select` takes 4 (tag type, tag length, and serial number are
  three separate output pointers, not one) — this specific mismatch is
  what caused the earlier crash, since a `__stdcall` callee that expects 4
  stack arguments and gets 2 will read garbage stack memory as its missing
  pointers and write through them. `ACR120_RequestDLLVersion` takes 2 (a
  length pointer *and* a buffer, not just a buffer). `ACR120_ListTags`
  takes 5. `ACR120_Login` takes a `Sector` (not the block number the rest
  of this module's callers use — `acr120.js` derives it internally) plus
  an unused `StoredNo` slot.

**RESOLVED (2026-08-22) — Godrej's real sector key, captured live.** Every
sector on a real guest card came back `LOCKED` against every well-known
Mifare default key (found running `dumpCard.js` for the first time) —
meaning Godrej rekeyed the cards it issues, sound security practice, but a
real blocker since those keys aren't in the SDK either. Unblocked by
intercepting the raw calls `btlock57.exe` itself makes while encoding a
real card, using API Monitor (rohitab.com, installed via
`choco install apimonitor`) with a custom XML definition written for
`ACR120U.dll`'s real signatures (see `docs/`'s parent directory history for
that file's evolution — two iterations: fixed-size buffer params need
`Type="BYTE [N]"`, a bracketed array on the type itself, not a
`Length="N"` attribute, which silently decodes as 1 byte).

Two things fell out of that capture:

- **btlock57.exe actually loads `AcsReader.dll` at runtime, not
  `ACR120U.dll`** — but exports the identical `ACR120_*` function names, so
  API Monitor still matched captured calls against the `ACR120U.dll`
  definition by function name. Worth knowing if this ever needs
  re-deriving on a different machine/install.
- **The key is constant, not per-card.** Every `ACR120_Login` call across
  the whole encode sequence used the identical key: `Key A = 1ab23cd45ef6`.
  The `ACR120_Write` to each sector's trailer block (e.g. block 3 of sector
  0) confirmed it further — Key A unchanged, access bits `FF078069`
  (Mifare's own default, not customized), Key B `FFFFFFFFFFFF` (also
  default). Godrej never varies the key per card; it's one fixed value
  compiled into `btlock57.exe`.

Added to `dumpCard.js`'s `CANDIDATE_KEYS`, tried first, and confirmed
against real hardware: opens sectors 0, 1, and 2 (3–15 stay locked — either
unused by Godrej or genuinely untouched factory sectors; doesn't matter
which for deriving the room-card layout).

**Still unknown — the actual room-card data format.** Now that sectors
0–2 are readable, *what bytes make a card open a Godrej lock* (how room
number / expiry / holder are packed into the block) is the next and final
piece — proprietary logic baked into `btlock57.exe`'s compiled code, not
exposed by the DLL or `tabstruc.sql`. See `src/cardLayout.ts` for the
dump/diff derivation plan (encode two cards with different rooms/expiries,
dump both, diff the bytes) — now genuinely unblocked and ready to run.

## Room/date fields located; checksum confirmed unrecoverable (2026-08-24)

Ran the dump/diff plan on real hardware at the front desk (RD-Z08 + RW-41,
real guest test cards via `btlock57.exe`). Four cards, three controlled
variables — room 405/co25, room 406/co25 (isolates room), room 405/co26
(isolates checkout), room 204/co25 (isolates floor) — all checkin 24-Aug.

**Located, all on sector 0:**

| Field | Location | Format |
|---|---|---|
| Checkin | block 1, bytes 6–9 | `HH DD MM YY`, each byte BCD |
| Checkout | block 2, bytes 12–14 | `DD MM YY`, BCD |
| Room floor digit | block 1, byte 12 | BCD |
| Room within floor | block 1, byte 13 | BCD, two digits |
| Room "signature" | block 1, bytes 6–8 | stable per room, confirmed across two different physical cards (different UID) encoding the same room |

**Confirmed by direct hardware test, not inferred:** block 1 byte 4 and
block 2 byte 15 are a keyed checksum/MAC, not static data. Proof, in order:

1. `patchBlock.js` flipped only the room-unit byte (block 1[13]) on a real
   card, leaving everything else — including the source card's own
   checksum bytes — untouched. Presented at the real door: **green light,
   no click** (read okay, access declined; confirmed by comparing against
   a known-good card's green+click+motor-sound signature at the same
   door).
2. Fully cloned every differing byte from a real, working room-406 card
   (blocks 1, 2, and 4) onto the room-405 test card, keeping only its
   original UID (block 0 is factory-locked, can't be changed). Presented
   at the door: **green, then red, no click** — an almost-perfect clone,
   differing only in UID, still explicitly rejected. This is what pointed
   at UID-dependence.
3. To isolate UID's actual contribution, re-encoded that *same physical
   card* for room 406 with the *same* checkin/checkout as the real
   room-406 card, using `btlock57.exe` itself (not our patch tool) — so
   the only real variable left was UID. Diffing that against the real
   room-406 card showed bytes 6–8 in block 1 matched exactly (confirming
   the room "signature" above), but bytes 3, 4, 10 (block 1) and 5, 15
   (block 2) still differed.
4. Decisive test: re-encoded the *same card, same room, same dates* a
   second time, seconds later, via `btlock57.exe`. Bytes 3 and 10 (block
   1) each moved by a clean `+1` — harmless transaction counters, not
   security fields. But **byte 4 (block 1) and byte 15 (block 2) still
   changed, unpredictably**, between two back-to-back encodes of
   identical input. Checked both samples by hand against a plain XOR/sum
   checksum over the rest of the block — neither matches. Not time-based
   (would need much finer resolution to explain the jump), not UID-based
   (same card both times), not a simple checksum. This is a real keyed
   MAC, and cracking it needs Godrej's actual algorithm/key — not
   recoverable by dumping and diffing cards, no matter how many more are
   captured. Reverse-engineering `btlock57.exe`'s compiled logic directly
   (disassembly) is a different, larger effort, not attempted here.

**Practical conclusion:** `device-service/src/cardLayout.ts#encodeGuestCard()`
stays a deliberate throw. The system's existing fallback — front desk
hand-encodes via `btlock57.exe`, `server/`'s `POST /:id/cards` records the
card either way and tells the UI which happened — is not a stopgap, it's
the correct answer until someone takes on disassembling the vendor binary.

## Architecture consequence: both DLLs are 32-bit

`file` confirms both are `PE32 ... Intel 80386` — 32-bit only. Modern Node.js
on Windows ships x64/arm64; a 64-bit process cannot `LoadLibrary` a 32-bit
DLL. That's why this is two packages, not one: `bridge32/` is a 32-bit Node
process that talks to the hardware directly, and `device-service/` (the
64-bit control API, matching the rest of this repo's stack) talks to
`bridge32` over localhost HTTP rather than loading the DLLs itself. See the
top-level `device-service/README.md` for the full picture.
