"use strict";

// Installs bridge32 as a Windows Service so it stays up across reboots.
// Must run under a 32-bit Node — the vendor DLLs (CH375DLL.DLL,
// ACR120U.dll) are 32-bit and cannot load into a 64-bit process (see
// ../docs/VENDOR_SDK_FINDINGS.md). This script itself can run under
// whatever Node is on PATH; what matters is BRIDGE32_NODE_EXE, which pins
// the *service's* Node to a 32-bit build regardless of what's on PATH.
//
// Usage:
//   BRIDGE32_NODE_EXE="C:\path\to\node-v22.x.x-win-x86\node.exe" node scripts/install-service.js
// Undo:
//   node scripts/uninstall-service.js

const path = require("path");
const { Service } = require("node-windows");

const projectRoot = path.join(__dirname, "..");
const execPath = process.env.BRIDGE32_NODE_EXE;

if (!execPath) {
  console.error("BRIDGE32_NODE_EXE is not set — point it at a 32-bit (ia32) node.exe first.");
  console.error("Without it, this service runs under whatever node.exe node-windows finds on");
  console.error("PATH, which on a normal install is 64-bit and can't load the vendor DLLs.");
  process.exit(1);
}

const svc = new Service({
  name: "SVDash Godrej Bridge32",
  description:
    "32-bit hardware bridge for the Godrej RD-Z08 lock programmer and RW-41 card encoder.",
  script: path.join(projectRoot, "server.js"),
  execPath,
  // config.js resolves DLL paths and .env relative to process.cwd() —
  // Windows starts services from system32 by default, so this has to be
  // set explicitly or those paths silently don't resolve.
  workingDirectory: projectRoot,
  maxRestarts: 5,
  wait: 2,
  grow: 0.5,
});

svc.on("install", () => {
  console.log("Installed. Starting service...");
  svc.start();
});
svc.on("alreadyinstalled", () => {
  console.log("Already installed — run uninstall-service.js first if you want to reinstall.");
});
svc.on("start", () => console.log(`${svc.name} is running.`));
svc.on("error", (err) => console.error("Service error:", err));

svc.install();
