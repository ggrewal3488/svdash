import { Router } from "express";
import { GuestRole, IdType } from "@prisma/client";
import { db } from "../db";
import { pushGuestToSheet, toSheetDate } from "../bridge/pushToSheet";
import { fetchBookings, parseGuestName } from "../bridge/fetchBookings";

export const reservationsRouter = Router();

// The Bookings tab has no property column — this deployment serves one
// property (StayVista Residences Gurgaon), so every booking is attributed to
// the code configured here.
function propertyConfig() {
  return {
    code: process.env.PROPERTY_CODE ?? "SVR-GGN",
    name: process.env.PROPERTY_NAME ?? "StayVista Residences Gurgaon",
  };
}

reservationsRouter.post("/sync", async (_req, res) => {
  const synced = [];

  try {
    const bookings = await fetchBookings();
    const { code, name } = propertyConfig();

    const property = await db.property.upsert({
      where: { code },
      update: {},
      create: { code, name },
    });

    for (const b of bookings) {
      if (!b.checkin || !b.checkout) {
        console.warn(`skipping booking ${b.bookingId}: missing check-in/check-out`);
        continue;
      }

      const reservation = await db.reservation.upsert({
        where: { externalPmsId: b.bookingId },
        update: {
          checkin: new Date(b.checkin),
          checkout: new Date(b.checkout),
          pax: b.pax,
          sourcePrimary: b.sourcePrimary,
          sourceSecondary: b.sourceSecondary,
        },
        create: {
          externalPmsId: b.bookingId,
          propertyId: property.id,
          checkin: new Date(b.checkin),
          checkout: new Date(b.checkout),
          pax: b.pax,
          sourcePrimary: b.sourcePrimary,
          sourceSecondary: b.sourceSecondary,
        },
      });

      // The sheet names one guest per booking — the primary. Any additional
      // pax are collected by the front desk via /:id/guests, so this only ever
      // touches the primary link and leaves those alone.
      const { salutation, lastName } = parseGuestName(b.guestName);
      if (lastName) {
        const existingLink = await db.reservationGuest.findFirst({
          where: { reservationId: reservation.id, role: GuestRole.primary },
        });

        if (existingLink) {
          await db.guest.update({
            where: { id: existingLink.guestId },
            data: { salutation, firstName: "", lastName },
          });
        } else {
          const guest = await db.guest.create({
            data: { salutation, firstName: "", lastName },
          });
          await db.reservationGuest.create({
            data: { reservationId: reservation.id, guestId: guest.id, role: GuestRole.primary },
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

// Front desk capturing a guest's details at the desk: name, phone and an ID
// proof, which check-in requires for every pax on the booking. Posting for a
// role that already exists updates that guest rather than adding a duplicate,
// so the primary created by /sync gets filled in rather than doubled.
reservationsRouter.post("/:id/guests", async (req, res) => {
  const body = req.body ?? {};
  const lastName = String(body.lastName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const role: GuestRole = body.role === "primary" ? GuestRole.primary : GuestRole.secondary;

  if (!lastName || !phone) {
    res.status(400).json({ ok: false, error: "lastName and phone are required" });
    return;
  }
  const idType = String(body.idType ?? "").trim();
  const idNumber = String(body.idNumber ?? "").trim();
  if (!idType || !idNumber) {
    res.status(400).json({ ok: false, error: "idType and idNumber are required" });
    return;
  }
  if (!Object.values(IdType).includes(idType as IdType)) {
    res.status(400).json({
      ok: false,
      error: `idType must be one of: ${Object.values(IdType).join(", ")}`,
    });
    return;
  }

  try {
    const reservation = await db.reservation.findUnique({
      where: { id: req.params.id },
      include: { guests: true },
    });
    if (!reservation) {
      res.status(404).json({ ok: false, error: "reservation not found" });
      return;
    }
    if (reservation.pax !== null && reservation.guests.length >= reservation.pax && role !== GuestRole.primary) {
      res.status(409).json({
        ok: false,
        error: `booking is for ${reservation.pax} pax and already has that many guests`,
      });
      return;
    }

    // Omitted optional fields must not blank out what /sync already derived —
    // posting details without a salutation shouldn't wipe the one parsed off
    // the sheet's guest name.
    const salutation = String(body.salutation ?? "").trim();
    const email = String(body.email ?? "").trim();
    const firstName = String(body.firstName ?? "").trim();
    const guestData = {
      lastName,
      phone,
      ...(salutation ? { salutation } : {}),
      ...(email ? { email } : {}),
      ...(firstName ? { firstName } : {}),
    };

    // Only the primary is de-duplicated by role: a booking has exactly one,
    // but any number of secondaries.
    const existingLink =
      role === GuestRole.primary
        ? await db.reservationGuest.findFirst({
            where: { reservationId: reservation.id, role: GuestRole.primary },
          })
        : null;

    const guest = existingLink
      ? await db.guest.update({ where: { id: existingLink.guestId }, data: guestData })
      : await db.guest.create({ data: { firstName: "", ...guestData } });

    if (!existingLink) {
      await db.reservationGuest.create({
        data: { reservationId: reservation.id, guestId: guest.id, role },
      });
    }

    const idDocument = await db.idDocument.create({
      data: {
        guestId: guest.id,
        idType: idType as IdType,
        idNumber,
        issuingCountry: String(body.issuingCountry ?? "").trim() || null,
        scanRef: String(body.scanRef ?? "").trim() || null,
      },
    });

    res.json({ ok: true, guest, idDocument });
  } catch (err) {
    console.error("add guest failed:", err);
    res.status(500).json({ ok: false, error: "add guest failed" });
  }
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

    // The inventory is a fixed 36 rooms, so an unknown number is a typo, not a
    // new room — look it up rather than upserting a phantom into inventory.
    const room = await db.room.findUnique({
      where: { propertyId_roomNumber: { propertyId: reservation.propertyId, roomNumber } },
    });
    if (!room) {
      res.status(404).json({ ok: false, error: `room ${roomNumber} does not exist` });
      return;
    }

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
      include: {
        room: true,
        guests: { include: { guest: { include: { idDocuments: true } } } },
      },
    });

    if (!reservation) {
      res.status(404).json({ ok: false, error: "reservation not found" });
      return;
    }
    if (!reservation.room) {
      res.status(409).json({ ok: false, error: "assign a room before checking in" });
      return;
    }

    if (reservation.room.status !== "vacant_ready") {
      res.status(409).json({
        ok: false,
        error: `room ${reservation.room.roomNumber} is ${reservation.room.status}, not vacant_ready`,
      });
      return;
    }

    const primary = reservation.guests.find((g) => g.role === GuestRole.primary);
    if (!primary) {
      res.status(409).json({ ok: false, error: "reservation has no primary guest" });
      return;
    }

    // The front desk must have name, phone and an ID proof on file for every
    // pax before the guest can be checked in.
    if (reservation.pax !== null) {
      const documented = reservation.guests.filter(
        (g) => g.guest.phone && g.guest.idDocuments.length > 0,
      ).length;
      if (documented < reservation.pax) {
        res.status(409).json({
          ok: false,
          error: `guest details required for all ${reservation.pax} pax — ${documented} on file`,
        });
        return;
      }
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
    // becomes vacant_dirty — only housekeeping moves it to vacant_ready.
    const [updated] = await db.$transaction([
      db.reservation.update({
        where: { id: reservation.id },
        data: { status: "checked_out" },
      }),
      db.room.update({
        where: { id: reservation.room.id },
        data: { status: "vacant_dirty" },
      }),
    ]);

    res.json({ ok: true, reservation: updated, clearedRoom: reservation.room.roomNumber });
  } catch (err) {
    console.error("check-out failed:", err);
    res.status(500).json({ ok: false, error: "check-out failed" });
  }
});
