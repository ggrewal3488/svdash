// Writes into the Guests sheet that every TV already polls — reuses the
// same pushGuest_ endpoint the Master Android app calls today
// (master/backend/Code.gs). No auth needed: pushGuest_ only checks a token
// if one is sent, and the Master app already posts without one.

const BRIDGE_URL = process.env.BRIDGE_SHEET_URL;

export interface GuestPush {
  roomNo: string;
  salutation?: string;
  lastName: string;
  checkin?: string;
  checkout?: string;
  message?: string;
}

export async function pushGuestToSheet(guest: GuestPush): Promise<void> {
  if (!BRIDGE_URL) {
    throw new Error("BRIDGE_SHEET_URL is not set — see server/.env.example");
  }

  const res = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(guest),
  });

  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Bridge push failed for room ${guest.roomNo}: ${data.error ?? "unknown error"}`);
  }
}
