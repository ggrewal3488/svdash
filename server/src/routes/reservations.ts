import { Router } from "express";
import { readFileSync } from "fs";
import { join } from "path";
import { GuestRole } from "@prisma/client";
import { db } from "../db";
import { pushGuestToSheet, toSheetDate } from "../bridge/pushToSheet";

export const reservationsRouter = Router();

interface ExternalGuest {
  role: GuestRole;
  salutation?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
}

interface ExternalReservation {
  externalPmsId: string;
  propertyCode: string;
  propertyName: string;
  checkin: string;
  checkout: string;
  guests: ExternalGuest[];
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

      // Guest has no external id to upsert on, so key off the reservation's
      // existing link for that role: re-syncing updates the same Guest row
      // rather than piling up duplicates for the same booking.
      for (const g of r.guests) {
        const existingLink = await db.reservationGuest.findFirst({
          where: { reservationId: reservation.id, role: g.role },
        });

        if (existingLink) {
          await db.guest.update({
            where: { id: existingLink.guestId },
            data: {
              salutation: g.salutation,
              firstName: g.firstName,
              lastName: g.lastName,
              phone: g.phone,
              email: g.email,
            },
          });
        } else {
          const guest = await db.guest.create({
            data: {
              salutation: g.salutation,
              firstName: g.firstName,
              lastName: g.lastName,
              phone: g.phone,
              email: g.email,
            },
          });
          await db.reservationGuest.create({
            data: { reservationId: reservation.id, guestId: guest.id, role: g.role },
          });
        }
      }

      synced.push(reservation);
    }
  } catch (err) {
    console.error("reservations/sync failed:", err);
    res.status(500).json({ ok: false, error: "sync failed" });
    return;
  }

  res.json({ ok: true, synced: synced.length, reservations: synced });
});

// Rooms are assigned by hand, never by the sync — /sync deliberately leaves
// roomId null. This is the front-desk action that sets it.
reservationsRouter.post("/:id/room", async (req, res) => {
  const roomNumber = String(req.body?.roomNumber ?? "").trim();
  if (!roomNumber) {
    res.status(400).json({ ok: false, error: "roomNumber is required" });
    return;
  }

  try {
    const reservation = await db.reservation.findUnique({ where: { id: req.params.id } });
    if (!reservation) {
      res.status(404).json({ ok: false, error: "reservation not found" });
      return;
    }

    const room = await db.room.upsert({
      where: { propertyId_roomNumber: { propertyId: reservation.propertyId, roomNumber } },
      update: {},
      create: { propertyId: reservation.propertyId, roomNumber },
    });

    const updated = await db.reservation.update({
      where: { id: reservation.id },
      data: { roomId: room.id },
    });

    res.json({ ok: true, reservation: updated, room });
  } catch (err) {
    console.error("assign room failed:", err);
    res.status(500).json({ ok: false, error: "assign room failed" });
  }
});

// Check-in is what actually reaches the TVs: it flips the reservation to
// checked_in, marks the room occupied, and writes the primary guest into the
// Guests sheet every TV already polls.
reservationsRouter.post("/:id/check-in", async (req, res) => {
  try {
    const reservation = await db.reservation.findUnique({
      where: { id: req.params.id },
      include: { room: true, guests: { include: { guest: true } } },
    });

    if (!reservation) {
      res.status(404).json({ ok: false, error: "reservation not found" });
      return;
    }
    if (!reservation.room) {
      res.status(409).json({ ok: false, error: "assign a room before checking in" });
      return;
    }

    const primary = reservation.guests.find((g) => g.role === GuestRole.primary);
    if (!primary) {
      res.status(409).json({ ok: false, error: "reservation has no primary guest" });
      return;
    }

    await pushGuestToSheet({
      roomNo: reservation.room.roomNumber,
      salutation: primary.guest.salutation ?? "",
      lastName: primary.guest.lastName,
      checkin: toSheetDate(reservation.checkin),
      checkout: toSheetDate(reservation.checkout),
      message: reservation.message ?? "",
    });

    // Only record the check-in once the TV bridge actually accepted the push,
    // so a failed bridge write doesn't leave a guest marked in with a stale TV.
    const [updated] = await db.$transaction([
      db.reservation.update({
        where: { id: reservation.id },
        data: { status: "checked_in" },
      }),
      db.room.update({
        where: { id: reservation.room.id },
        data: { status: "occupied" },
      }),
    ]);

    res.json({ ok: true, reservation: updated, pushedToRoom: reservation.room.roomNumber });
  } catch (err) {
    console.error("check-in failed:", err);
    res.status(500).json({ ok: false, error: "check-in failed" });
  }
});

// Check-out clears the room's TV. The Apps Script has no delete action, so a
// blank lastName is how a room reads as vacant: getAllRoomsJson_ skips rows
// with no lastName, and the TV's joinGuestName() hides the welcome line.
reservationsRouter.post("/:id/check-out", async (req, res) => {
  try {
    const reservation = await db.reservation.findUnique({
      where: { id: req.params.id },
      include: { room: true },
    });

    if (!reservation) {
      res.status(404).json({ ok: false, error: "reservation not found" });
      return;
    }
    if (reservation.status !== "checked_in") {
      res.status(409).json({ ok: false, error: "reservation is not checked in" });
      return;
    }
    if (!reservation.room) {
      res.status(409).json({ ok: false, error: "reservation has no room" });
      return;
    }

    await pushGuestToSheet({
      roomNo: reservation.room.roomNumber,
      salutation: "",
      lastName: "",
      checkin: "",
      checkout: "",
      message: "",
    });

    // Same ordering as check-in: clear the TV first, so a failed push never
    // leaves a checked-out room still welcoming the departed guest. The room
    // goes to cleaning rather than available — housekeeping releases it.
    const [updated] = await db.$transaction([
      db.reservation.update({
        where: { id: reservation.id },
        data: { status: "checked_out" },
      }),
      db.room.update({
        where: { id: reservation.room.id },
        data: { status: "cleaning" },
      }),
    ]);

    res.json({ ok: true, reservation: updated, clearedRoom: reservation.room.roomNumber });
  } catch (err) {
    console.error("check-out failed:", err);
    res.status(500).json({ ok: false, error: "check-out failed" });
  }
});
