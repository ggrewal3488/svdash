// This is the one piece the vendor SDK genuinely does not give us: which
// Mifare sector/block, which key, and which byte layout makes a card open a
// Godrej lock for a given room and expiry. bridge32 can already read and
// write raw blocks (see bridge32Client.ts) — what's missing is knowing what
// to put in them. That logic lives compiled into btlock57.exe and isn't
// recoverable from the DLLs, the database schema (tabstruc.sql only has the
// *business* tables — issuedcards, doors, cardsector — not a byte format),
// or any file in the SDK we were given.
//
// Guessing a layout and shipping it would produce cards that build cleanly
// and fail silently at the actual lock door — worse than not having this at
// all. The layout has to be derived empirically instead, on the real
// front-desk hardware:
//
//   1. Encode one test card for one room using the real btlock57.exe app.
//   2. Dump every sector of that card with POST /acr120/read-block on each
//      block (0..63 for a 1K Mifare card), trying the well-known Mifare
//      default keys (FFFFFFFFFFFF, A0A1A2A3A4A5, D3F7D3F7D3F7, ...) per
//      sector until login() succeeds — Godrej likely didn't change every
//      sector's key from the factory default.
//   3. Encode a second test card for a different room / different expiry
//      with btlock57.exe, dump it the same way, and diff the two raw dumps.
//      The bytes that differ are where room number / expiry / holder live;
//      the ones that match across both are fixed header/config bytes.
//   4. Once that mapping is confirmed against a few more real cards (and a
//      hand-written card actually opens the real lock), encode it here as
//      encodeGuestCard() below.
//
// Until then, this throws rather than writing plausible-looking garbage to
// a guest's key card.

export interface GuestCardSpec {
  roomNumber: string;
  expiresAt: Date;
}

export function encodeGuestCard(_spec: GuestCardSpec): never {
  throw new Error(
    "card layout unknown — see the derivation steps documented at the top of this file " +
      "before wiring this up",
  );
}
