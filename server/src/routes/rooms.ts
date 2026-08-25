import { Router } from "express";
import { RoomStatus } from "@prisma/client";
import { db } from "../db";
import { logRoomStatus } from "../bridge/pushToSheet";

export const roomsRouter = Router();

// Rooms are addressed by number rather than id — that's what housekeeping and
// the front desk actually read off a door and a worksheet.
async function findRoom(roomNumber: string) {
  const code = process.env.PROPERTY_CODE ?? "SVR-GGN";
  const property = await db.property.findUnique({ where: { code } });
  if (!property) return null;
  return db.room.findUnique({
    where: { propertyId_roomNumber: { propertyId: property.id, roomNumber } },
  });
}

// The housekeeping worksheet: what needs cleaning, what's sellable, what's out.
roomsRouter.get("/", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !Object.values(RoomStatus).includes(status as RoomStatus)) {
      res.status(400).json({
        ok: false,
        error: `status must be one of: ${Object.values(RoomStatus).join(", ")}`,
      });
      return;
    }

    const rooms = await db.room.findMany({
      where: status ? { status: status as RoomStatus } : undefined,
      orderBy: { roomNumber: "asc" },
    });
    res.json({ ok: true, count: rooms.length, rooms });
  } catch (err) {
    console.error("list rooms failed:", err);
    res.status(500).json({ ok: false, error: "list rooms failed" });
  }
});

// Housekeeping releasing a room after cleaning it. This is the only way a
// vacant_dirty room becomes sellable again — check-out never does it directly.
roomsRouter.post("/:roomNumber/ready", async (req, res) => {
  try {
    const room = await findRoom(req.params.roomNumber);
    if (!room) {
      res.status(404).json({ ok: false, error: `room ${req.params.roomNumber} does not exist` });
      return;
    }
    if (room.status === RoomStatus.occupied) {
      res.status(409).json({ ok: false, error: "room is occupied — check the guest out first" });
      return;
    }

    const updated = await db.room.update({
      where: { id: room.id },
      data: { status: RoomStatus.vacant_ready },
    });

    logRoomStatus({
      roomNo: updated.roomNumber,
      previousStatus: room.status,
      newStatus: updated.status,
      username: req.user!.username,
      role: req.user!.role,
    }).catch((err) => console.error("HK log failed (room marked ready anyway):", err));

    res.json({ ok: true, room: updated });
  } catch (err) {
    console.error("mark room ready failed:", err);
    res.status(500).json({ ok: false, error: "mark room ready failed" });
  }
});

// Taking a room out of service (or putting it back) — maintenance, out_of_order,
// or flagging one dirty again without a check-out behind it.
roomsRouter.post("/:roomNumber/status", async (req, res) => {
  const status = String(req.body?.status ?? "").trim();
  if (!Object.values(RoomStatus).includes(status as RoomStatus)) {
    res.status(400).json({
      ok: false,
      error: `status must be one of: ${Object.values(RoomStatus).join(", ")}`,
    });
    return;
  }

  try {
    const room = await findRoom(req.params.roomNumber);
    if (!room) {
      res.status(404).json({ ok: false, error: `room ${req.params.roomNumber} does not exist` });
      return;
    }
    // Occupancy is owned by check-in/check-out, so it isn't settable by hand —
    // otherwise a room could be marked free while its guest is still in it.
    if (status === RoomStatus.occupied || room.status === RoomStatus.occupied) {
      res.status(409).json({
        ok: false,
        error: "occupied is set by check-in and cleared by check-out, not here",
      });
      return;
    }

    const updated = await db.room.update({
      where: { id: room.id },
      data: { status: status as RoomStatus },
    });

    logRoomStatus({
      roomNo: updated.roomNumber,
      previousStatus: room.status,
      newStatus: updated.status,
      username: req.user!.username,
      role: req.user!.role,
    }).catch((err) => console.error("HK log failed (room status changed anyway):", err));

    res.json({ ok: true, room: updated });
  } catch (err) {
    console.error("set room status failed:", err);
    res.status(500).json({ ok: false, error: "set room status failed" });
  }
});
