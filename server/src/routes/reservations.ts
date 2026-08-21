import { Router } from "express";
import { GuestRole, IdType, ReservationStatus } from "@prisma/client";
import { db } from "../db";
import { pushGuestToSheet, toSheetDate } from "../bridge/pushToSheet";
import { syncReservations } from "../services/syncReservations";

export const reservationsRouter = Router();

reservationsRouter.post("/sync", async (_req, res) => {
  try {
    const { synced, skipped } = await syncReservations();
    res.json({ ok: true, synced: synced.length, skipped: skipped.length, reservations: synced });
  } catch (err) {
    console.error("reservations/sync failed:", err);
    res.status(500).json({ ok: false, error: "sync failed" });
  }
});

// The front desk's arrivals/in-house list. Includes each guest's documented
// state so the UI can show at a glance which bookings still need ID proofs
// collected before they can be checked in.
reservationsRouter.get("/", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !Object.values(ReservationStatus).includes(status as ReservationStatus)) {
      res.status(400).json({
        ok: false,
        error: `status must be one of: ${Object.values(ReservationStatus).join(", ")}`,
      });
      return;
    }

    const reservations = await db.reservation.findMany({
      where: status ? { status: status as ReservationStatus } : undefined,
      include: {
        room: true,
        guests: { include: { guest: { include: { idDocuments: true } } } },
      },
      orderBy: { checkin: "asc" },
    });

    res.json({
      ok: true,
      count: reservations.length,
      reservations: reservations.map((r) => ({
        ...r,
        documentedGuests: r.guests.filter((g) => g.guest.phone && g.guest.idDocuments.length > 0).length,
      })),
    });
  } catch (err) {
    console.error("list reservations failed:", err);
    res.status(500).json({ ok: false, error: "list reservations failed" });
  }
});

reservationsRouter.get("/:id", async (req, res) => {
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
    res.json({ ok: true, reservation });
  } catch (err) {
    console.error("get reservation failed:", err);
    res.status(500).json({ ok: false, error: "get reservation failed" });
  }
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

// Front desk handing over a physical key card. A card is scoped to this
// reservation's room, so it can't be issued until check-in has actually put
// a guest in that room — issuing one earlier would key a room nobody's in.
reservationsRouter.post("/:id/cards", async (req, res) => {
  const guestId = String(req.body?.guestId ?? "").trim();
  if (!guestId) {
    res.status(400).json({ ok: false, error: "guestId is required" });
    return;
  }

  try {
    const reservation = await db.reservation.findUnique({
      where: { id: req.params.id },
      include: { room: true, guests: true },
    });
    if (!reservation) {
      res.status(404).json({ ok: false, error: "reservation not found" });
      return;
    }
    if (!reservation.room) {
      res.status(409).json({ ok: false, error: "reservation has no room" });
      return;
    }
    if (reservation.status !== "checked_in") {
      res.status(409).json({ ok: false, error: "check the guest in before issuing a card" });
      return;
    }
    if (!reservation.guests.some((g) => g.guestId === guestId)) {
      res.status(400).json({ ok: false, error: "guest is not on this reservation" });
      return;
    }

    const card = await db.card.create({
      data: { guestId, roomId: reservation.room.id, expiresAt: reservation.checkout },
    });
    res.json({ ok: true, card });
  } catch (err) {
    console.error("issue card failed:", err);
    res.status(500).json({ ok: false, error: "issue card failed" });
  }
});

reservationsRouter.get("/:id/cards", async (req, res) => {
  try {
    const reservation = await db.reservation.findUnique({
      where: { id: req.params.id },
      include: { guests: true },
    });
    if (!reservation) {
      res.status(404).json({ ok: false, error: "reservation not found" });
      return;
    }

    const cards = await db.card.findMany({
      where: { guestId: { in: reservation.guests.map((g) => g.guestId) } },
      include: { guest: true },
      orderBy: { issuedAt: "desc" },
    });
    res.json({ ok: true, cards });
  } catch (err) {
    console.error("list cards failed:", err);
    res.status(500).json({ ok: false, error: "list cards failed" });
  }
});

// Check-out clears the room's TV. The Apps Script has no delete action, so a
// blank lastName is how a room reads as vacant: getAllRoomsJson_ skips rows
// with no lastName, and the TV's joinGuestName() hides the welcome line.
reservationsRouter.post("/:id/check-out", async (req, res) => {
  try {
    const reservation = await db.reservation.findUnique({
      where: { id: req.params.id },
      include: { room: true, guests: true },
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
    // becomes vacant_dirty — only housekeeping moves it to vacant_ready. Any
    // cards issued for this stay are revoked here too, so a departed guest's
    // key stops working the moment the room does.
    const [updated] = await db.$transaction([
      db.reservation.update({
        where: { id: reservation.id },
        data: { status: "checked_out" },
      }),
      db.room.update({
        where: { id: reservation.room.id },
        data: { status: "vacant_dirty" },
      }),
      db.card.updateMany({
        where: {
          roomId: reservation.room.id,
          guestId: { in: reservation.guests.map((g) => g.guestId) },
          status: { not: "revoked" },
        },
        data: { status: "revoked" },
      }),
    ]);

    res.json({ ok: true, reservation: updated, clearedRoom: reservation.room.roomNumber });
  } catch (err) {
    console.error("check-out failed:", err);
    res.status(500).json({ ok: false, error: "check-out failed" });
  }
});
