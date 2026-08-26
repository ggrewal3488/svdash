// Writes into the Guests sheet that every TV already polls — reuses the
// same pushGuest_ endpoint the Master Android app calls today
// (master/backend/Code.gs). No auth needed: pushGuest_ only checks a token
// if one is sent, and the Master app already posts without one.

export interface GuestPush {
  roomNo: string;
  salutation?: string;
  lastName: string;
  checkin?: string;
  checkout?: string;
  message?: string;
}

export interface SheetRoom {
  roomNo: string;
  salutation?: string;
  lastName?: string;
  checkin?: string;
  checkout?: string;
  message?: string;
}

// The Guests sheet stores plain YYYY-MM-DD strings — that's what the Master
// web UI writes via <input type="date"> (master/web/index.html), and what the
// TVs render back. Format Prisma DateTimes the same way so bridge rows written
// by this API are indistinguishable from ones written by the Master app.
export function toSheetDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function pushGuestToSheet(guest: GuestPush): Promise<void> {
  // Read at call time, not module load: reading it into a const at import time
  // silently yields undefined if this module is ever imported before dotenv runs.
  const bridgeUrl = process.env.BRIDGE_SHEET_URL;
  if (!bridgeUrl) {
    throw new Error("BRIDGE_SHEET_URL is not set — see server/.env.example");
  }

  const res = await fetch(bridgeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(guest),
  });

  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Bridge push failed for room ${guest.roomNo}: ${data.error ?? "unknown error"}`);
  }
}

// Backs the "Update TV" tab's overwrite-confirm modal — same room lookup
// master/web does before a manual push, gated the same way (a shared device
// key rather than a session token, since this is server-to-server).
export async function getSheetRoom(roomNo: string): Promise<SheetRoom> {
  const bridgeUrl = process.env.BRIDGE_SHEET_URL;
  if (!bridgeUrl) {
    throw new Error("BRIDGE_SHEET_URL is not set — see server/.env.example");
  }
  const deviceKey = process.env.BRIDGE_DEVICE_KEY;
  if (!deviceKey) {
    throw new Error("BRIDGE_DEVICE_KEY is not set — see server/.env.example");
  }

  const url = `${bridgeUrl}?room=${encodeURIComponent(roomNo)}&key=${encodeURIComponent(deviceKey)}`;
  const res = await fetch(url);
  const data = (await res.json()) as SheetRoom & { ok?: boolean; error?: string };
  if (data.ok === false) {
    throw new Error(`Room lookup failed for room ${roomNo}: ${data.error ?? "unknown error"}`);
  }
  return data;
}

export interface RoomStatusLogEntry {
  roomNo: string;
  previousStatus: string;
  newStatus: string;
  username: string;
  role: string;
}

// Every room status change (housekeeping worksheet writes, from any role
// that can reach them) gets appended to the same Hotel DB sheet as an audit
// trail — logRoomStatus_ in master/backend/Code.gs. Best-effort: a logging
// failure shouldn't undo a real room status change, so callers should treat
// this as fire-and-forget the way pushGuestToSheet's callers don't (that one
// gates the TV, this one is just a record).
export async function logRoomStatus(entry: RoomStatusLogEntry): Promise<void> {
  const bridgeUrl = process.env.BRIDGE_SHEET_URL;
  const deviceKey = process.env.BRIDGE_DEVICE_KEY;
  if (!bridgeUrl || !deviceKey) return;

  const res = await fetch(bridgeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "logRoomStatus", key: deviceKey, ...entry }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Room status log failed for room ${entry.roomNo}: ${data.error ?? "unknown error"}`);
  }
}
