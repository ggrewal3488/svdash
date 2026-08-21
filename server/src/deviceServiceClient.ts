// Talks to device-service (../../device-service), the Windows Device Service
// from the Godrej lock-replacement blueprint. Optional by design: this API
// serves the front desk whether or not device-service is reachable, and
// whether or not it can physically encode a card yet (see device-service's
// src/cardLayout.ts — that piece isn't implemented until the Godrej card
// byte layout has been derived from real hardware). Callers treat a failure
// here as "couldn't reach the encoder / can't encode yet", not as an error
// that should block issuing a card in the system of record.
const DEVICE_SERVICE_URL = process.env.DEVICE_SERVICE_URL ?? "";

export interface EncodeCardResult {
  encoded: boolean;
  reason?: string;
}

export async function encodeCard(roomNumber: string, expiresAt: Date): Promise<EncodeCardResult> {
  if (!DEVICE_SERVICE_URL) {
    return { encoded: false, reason: "DEVICE_SERVICE_URL not configured" };
  }

  try {
    const res = await fetch(`${DEVICE_SERVICE_URL}/cards/encode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomNumber, expiresAt: expiresAt.toISOString() }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      return { encoded: false, reason: json.error ?? `device-service returned ${res.status}` };
    }
    return { encoded: true };
  } catch (err) {
    return { encoded: false, reason: (err as Error).message };
  }
}
