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

## Auth

Every route except `/health` requires `DEVICE_SERVICE_KEY` (as `x-api-key` or a bearer token — see `src/auth.ts`), the same fail-closed pattern `server/`'s `MASTER_API_KEY` uses: if the key isn't set, the service refuses all requests rather than running open in front of hardware that can write physical key cards. `server/`'s `deviceServiceClient.ts` sends this automatically once `DEVICE_SERVICE_URL`/`DEVICE_SERVICE_KEY` are set in its `.env` — the two keys must match.

## Running as a Windows Service

Both `device-service/` and `bridge32/` install as native Windows Services via `node-windows`, so they survive reboots and restart on crash instead of needing someone to remote in and run `npm start` by hand.

**device-service** (as Administrator, after `npm install && npm run build`):
```
npm run service:install
npm run service:uninstall   # to remove
```

**bridge32** — must be pinned to a 32-bit Node build via `BRIDGE32_NODE_EXE`, since the vendor DLLs can't load into whatever 64-bit Node is on PATH by default:
```
set BRIDGE32_NODE_EXE=C:\path\to\node-v22.x.x-win-x86\node.exe
npm run service:install
npm run service:uninstall   # to remove
```

Both install scripts set `workingDirectory` explicitly, since Windows starts services from `system32` by default and `.env`/DLL paths are resolved relative to `process.cwd()`.

## Status

Scaffolding only, not yet run against real hardware. Everything here is source code to bring to the front-desk PC: run `bridge32/verify.js` first, fix up `acr120.js`'s signatures against what it reports, then install both as services. `device-service/` itself only proxies health/version checks and a `/cards/encode` stub through to `bridge32/` right now — see `src/cardLayout.ts` for why real card encoding isn't wired up yet.
