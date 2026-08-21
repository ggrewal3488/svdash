import { Router } from "express";
import { readFileSync } from "fs";
import { join } from "path";
import { db } from "../db";

export const reservationsRouter = Router();

interface ExternalReservation {
  externalPmsId: string;
  propertyCode: string;
  propertyName: string;
  checkin: string;
  checkout: string;
}

// Stub source: a fixture standing in for the property's real PMS. Swap this
// for an actual fetch(process.env.PMS_API_URL) once that connector exists —
// everything below (the upsert-by-externalPmsId logic) stays the same either
// way, since it doesn't care where the rows came from.
function fetchFromExternalPms(): ExternalReservation[] {
  const raw = readFileSync(join(__dirname, "..", "..", "fixtures", "reservations.sample.json"), "utf-8");
  return JSON.parse(raw);
}

reservationsRouter.post("/sync", async (_req, res) => {
  const incoming = fetchFromExternalPms();
  const synced = [];

  try {
    for (const r of incoming) {
      const property = await db.property.upsert({
        where: { code: r.propertyCode },
        update: {},
        create: { code: r.propertyCode, name: r.propertyName },
      });

      const reservation = await db.reservation.upsert({
        where: { externalPmsId: r.externalPmsId },
        update: { checkin: new Date(r.checkin), checkout: new Date(r.checkout) },
        create: {
          externalPmsId: r.externalPmsId,
          propertyId: property.id,
          checkin: new Date(r.checkin),
          checkout: new Date(r.checkout),
        },
      });

      synced.push(reservation);
    }
  } catch (err) {
    console.error("reservations/sync failed:", err);
    res.status(500).json({ ok: false, error: "sync failed" });
    return;
  }

  res.json({ ok: true, synced: synced.length, reservations: synced });
});
