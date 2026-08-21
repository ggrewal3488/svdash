"use strict";

// Installs device-service as a Windows Service so it stays up across
// reboots and restarts on crash, instead of relying on someone remoting in
// and running `npm start` by hand. Run this once on the front-desk PC, as
// Administrator, after `npm install && npm run build`.
//
// Usage: node scripts/install-service.js
// Undo:  node scripts/uninstall-service.js

const path = require("path");
const { Service } = require("node-windows");

const projectRoot = path.join(__dirname, "..");

const svc = new Service({
  name: "SVDash Device Service",
  description:
    "Control API for the Godrej lock hardware (RD-Z08 programmer, RW-41 encoder), fronting bridge32.",
  script: path.join(projectRoot, "dist", "index.js"),
  // dotenv (loaded by dist/index.js) reads .env relative to process.cwd() —
  // Windows starts services from system32 by default, so without this set
  // explicitly, .env (and any other relative path) silently fails to
  // resolve and the service comes up unconfigured.
  workingDirectory: projectRoot,
  // Restart on crash, but back off rather than hammering a service that's
  // persistently broken (e.g. a bad DEVICE_SERVICE_KEY) every few seconds
  // forever.
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
