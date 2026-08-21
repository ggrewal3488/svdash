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
