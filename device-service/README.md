# device-service

The "Windows Device Service" from the Godrej-replacement blueprint ([[master_pms_platform]]) — the piece that talks to the actual lock-programming and card-encoding hardware. Sits between the `server/` Application API and the physical devices at the front desk.

## Why two packages

```
server/ (master-api)  --HTTP-->  device-service/  --HTTP-->  bridge32/  --DLL-->  hardware
  (this repo's existing            (64-bit Node,               (32-bit Node,
   Express/Prisma backend)          matches server/'s stack)     loads the vendor DLLs)
```

The vendor DLLs (`CH375DLL.DLL` for the RD-Z08 lock programmer, `ACR120U.dll` for the RW-41 card encoder) are 32-bit (`PE32 ... Intel 80386` — confirmed with `file`). Modern Node.js on Windows only ships as x64/arm64, and a 64-bit process can't `LoadLibrary` a 32-bit DLL. So the hardware access has to live in its own 32-bit process (`bridge32/`), and everything else — including the Application API this repo already has in `server/` — talks to it over plain localhost HTTP instead of loading the DLLs directly.

## What's actually verified here

Both DLLs turned out to be off-the-shelf vendor chip SDKs, not Godrej's own code — confirmed by pulling their real export tables with `objdump -p` against the files in the Godrej V5.7 install you provided. Full findings: [`docs/VENDOR_SDK_FINDINGS.md`](docs/VENDOR_SDK_FINDINGS.md). Short version:

- **CH375DLL.DLL** (WCH's generic USB chip) — well-documented, stable for 15+ years. `bridge32/ch375.js` implements the core open/read/write/reset calls with real confidence.
- **ACR120U.dll** (ACS's ACR120 Mifare reader) — function *names* are confirmed from the export table; exact parameter marshaling is not, since this SDK has no header file and ACS shipped several revisions with signature drift. `bridge32/acr120.js` has best-effort signatures from ACS's most commonly published API, every one flagged `UNVERIFIED` in the code.
- **The actual room-card byte format** (what makes a card open a specific Godrej lock) isn't in the SDK at all — it's compiled into `btlock57.exe` and has to be derived empirically from real hardware. See `src/cardLayout.ts` for the derivation plan; nothing here fabricates a guess at it.

## Before doing anything with real hardware

Run `bridge32/verify.js` on the actual front-desk Windows PC first, under a 32-bit Node build, with both devices plugged in:

```
cd bridge32
npm install
node verify.js
```

This proves the DLLs load and reports real values back — it doesn't program anything. Any `FAIL` on the ACR120 calls means that call's signature in `acr120.js` needs a fix; that's the expected first pass, not a sign something's broken.

## Status

Scaffolding only. Neither package has been built or run — there's no Windows machine or physical hardware available in this environment. Everything here is source code to bring to the front-desk PC, run `verify.js` against, and fix up from there. `device-service/` itself only proxies health/version checks through to `bridge32/` right now; there's deliberately no card-issuance endpoint yet because the byte layout it would need doesn't exist yet either.
