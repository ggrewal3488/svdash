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
//   0. DONE (2026-08-22): step 0 was originally blocked here — every
//      sector locked against every well-known Mifare default key, meaning
//      Godrej rekeyed them. Unblocked by running API Monitor
//      (rohitab.com) against a real btlock57.exe encode: it loads
//      AcsReader.dll (not ACR120U.dll — same ACR120_* export names,
//      different filename) and calls ACR120_Login with a single, constant
//      key across every card observed: Key A = 1ab23cd45ef6. The
//      ACR120_Write to each sector's trailer block confirms it — Key A
//      unchanged, access bits FF078069 (Mifare's own default), Key B
//      FFFFFFFFFFFF — so Godrej never actually varies the key per card,
//      it's one fixed key baked into btlock57.exe. Confirmed against real
//      hardware: this key opens sectors 0, 1, and 2 (3-15 stay locked —
//      unused by Godrej, or genuinely untouched factory sectors, doesn't
//      matter which). Already added to dumpCard.js's CANDIDATE_KEYS.
//      Full capture writeup in docs/VENDOR_SDK_FINDINGS.md.
//   1-3. DONE (2026-08-24): dumped and diffed real guest cards across
//      controlled room/date variations (405/25, 406/25, 405/26, 204/25) via
//      dumpCard.js / diffDumps.js. Located every content field on sector 0
//      (block indices are absolute Mifare block numbers, sector 0 = blocks
//      0-3, block 3 is the trailer and never touched):
//        - checkin date  = block 1, bytes 6-9: HH DD MM YY, each BCD
//          (e.g. 14 24 08 26 = checked in ~14:xx on 24-Aug-2026)
//        - checkout date = block 2, bytes 12-14: DD MM YY, BCD
//        - room number   = block 1: byte 12 = floor digit (BCD), byte 13 =
//          room-within-floor (BCD, two digits) — e.g. floor 4 room 05/06
//          for 405/406, floor 2 room 04 for 204
//        - a per-room "signature" fragment = block 1, bytes 6-8 — confirmed
//          stable for the same room across two different physical cards
//          (different UID, different encode session), so it's tied to the
//          room, not the card or the transaction
//        - two harmless transaction counters, not security-relevant: block
//          1 byte 3 and byte 10 both increment by exactly 1 between
//          consecutive encodes of the same room/dates on the same card;
//          block 2 byte 5 tracks btlock's own "Guest Index" (offset by a
//          constant +0x20 from the value shown in its UI)
//        - block 0 is the Mifare manufacturer block (UID + BCC + chip
//          data) — read-only, unrelated to room content, ignore entirely
//   4. BLOCKED (2026-08-24), confirmed by direct hardware test, not
//      assumption: block 1 byte 4 and block 2 byte 15 are a genuine
//      keyed checksum/MAC, not a static or simple-checksum field. Proved
//      by encoding the *same physical card* for the *same room and dates*
//      twice, seconds apart, via the real btlock57.exe — both bytes came
//      back different each time, and neither matches a plain XOR/sum
//      checksum over the rest of the block (checked by hand against both
//      samples). Whatever computes them is proprietary logic inside
//      btlock57.exe's compiled code, not derivable by observation.
//
//      Confirmed the hard way: patched a card to fully match every known
//      field of a real, working room-406 card (including this checksum,
//      copied verbatim from that working card) and presented it at the
//      real door. Lock read it (green light) but explicitly declined to
//      open (red light, no motor click) — an almost-perfect clone still
//      failed, because the checksum bytes we copied were only valid for
//      the *other* card's UID/session, not this one. Full transcript of
//      the derivation session (values, diffs, and the failed-clone test)
//      in docs/VENDOR_SDK_FINDINGS.md.
//
// Net result: room number, checkin, and checkout are fully located and
// reproducible — but a card can't be safely hand-assembled without also
// producing a valid checksum for it, and that checksum isn't derivable
// from card contents alone. Cracking it would mean reverse-engineering
// btlock57.exe's compiled logic directly (disassembly), a materially
// different and larger effort than this derivation was. Not attempted.
//
// Until that happens, this throws rather than writing a card that reads
// as plausible but silently fails at the door — see server/src/routes/
// reservations.ts's POST /:id/cards, which already treats that as the
// expected case: front desk hand-encodes via btlock57.exe, same as today.

export interface GuestCardSpec {
  roomNumber: string;
  expiresAt: Date;
}

export function encodeGuestCard(_spec: GuestCardSpec): never {
  throw new Error(
    "card checksum algorithm unknown — room/checkin/checkout fields are located but the " +
      "per-card checksum isn't derivable without reverse-engineering btlock57.exe; see the " +
      "derivation notes at the top of this file",
  );
}
