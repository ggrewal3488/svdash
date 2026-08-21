"use strict";

// The vendor DLLs aren't committed to the repo — they're Godrej/ACS/WCH
// binaries, not ours to redistribute. Point these at wherever the Godrej
// V5.7 install actually lives on the front-desk PC.
const CH375_DLL_PATH = process.env.CH375_DLL_PATH || "C:\\Godrej\\Godrej V5.7\\CH375DLL.DLL";
const ACR120_DLL_PATH = process.env.ACR120_DLL_PATH || "C:\\Godrej\\Godrej V5.7\\ACR120U.dll";
const PORT = process.env.BRIDGE32_PORT ? Number(process.env.BRIDGE32_PORT) : 8091;

module.exports = { CH375_DLL_PATH, ACR120_DLL_PATH, PORT };
