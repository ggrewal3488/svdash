// Reads the Bookings tab of the same spreadsheet the TVs already poll, via
// the getBookings action added to master/backend/Code.gs. This is the real
// source of reservations — it replaced the fixture that used to stand in for
// the property's PMS.

export interface SheetBooking {
  bookingId: string;
  guestName: string;
  checkin: string;
  checkout: string;
  pax: number | null;
  sourcePrimary: string;
  sourceSecondary: string;
}

export async function fetchBookings(): Promise<SheetBooking[]> {
  const bridgeUrl = process.env.BRIDGE_SHEET_URL;
  if (!bridgeUrl) {
    throw new Error("BRIDGE_SHEET_URL is not set — see server/.env.example");
  }
  // getBookings is authorised like the room endpoints, since booking rows
  // carry guest PII. The device key is the same shared secret the TV app uses.
  const deviceKey = process.env.BRIDGE_DEVICE_KEY;
  if (!deviceKey) {
    throw new Error("BRIDGE_DEVICE_KEY is not set — see server/.env.example");
  }

  const url = `${bridgeUrl}?action=getBookings&key=${encodeURIComponent(deviceKey)}`;
  const res = await fetch(url);
  const data = (await res.json()) as { ok: boolean; error?: string; bookings?: SheetBooking[] };

  if (!data.ok) {
    throw new Error(`Bookings fetch failed: ${data.error ?? "unknown error"}`);
  }
  return data.bookings ?? [];
}

const SALUTATIONS = ["mr", "mrs", "ms", "miss", "mx", "dr", "prof"];

/**
 * Splits a sheet's "Guest Name" into what the Guests sheet stores.
 *
 * The whole name is kept in lastName rather than guessed apart — the TV renders
 * salutation + lastName, so this shows "Welcome, Mr. Arjun Mehta" and never
 * mangles a multi-word surname. Only a leading salutation is peeled off, so it
 * lands in its own sheet column instead of being repeated in the name.
 */
export function parseGuestName(raw: string): { salutation: string; lastName: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { salutation: "", lastName: "" };

  const [first, ...rest] = name.split(" ");
  const normalised = first.toLowerCase().replace(/\.$/, "");

  if (rest.length > 0 && SALUTATIONS.includes(normalised)) {
    return { salutation: first, lastName: rest.join(" ") };
  }
  return { salutation: "", lastName: name };
}
