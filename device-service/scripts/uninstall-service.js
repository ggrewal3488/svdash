"use strict";

// Usage: node scripts/uninstall-service.js

const path = require("path");
const { Service } = require("node-windows");

const svc = new Service({
  name: "SVDash Device Service",
  script: path.join(__dirname, "..", "dist", "index.js"),
});

svc.on("uninstall", () => console.log("Uninstalled."));
svc.on("alreadyuninstalled", () => console.log("Not installed — nothing to do."));
svc.on("error", (err) => console.error("Service error:", err));

svc.uninstall();
