import { GuestRole, Reservation } from "@prisma/client";
import { db } from "../db";
import { fetchBookings, parseGuestName } from "../bridge/fetchBookings";

// The Bookings tab has no property column — this deployment serves one
// property (StayVista Residences Gurgaon), so every booking is attributed to
// the code configured here.
export function propertyConfig() {
  return {
    code: process.env.PROPERTY_CODE ?? "SVR-GGN",
    name: process.env.PROPERTY_NAME ?? "StayVista Residences Gurgaon",
  };
}

export interface SyncResult {
  synced: Reservation[];
  skipped: string[];
}

/**
 * Pulls the Bookings tab into the database. Lives outside the route handler
 * because the scheduler runs it too — on a timer there is no request to
 * respond to, so the work can't be tangled up with res.json().
 */
export async function syncReservations(): Promise<SyncResult> {
  const bookings = await fetchBookings();
  const { code, name } = propertyConfig();

  const property = await db.property.upsert({
    where: { code },
    update: {},
    create: { code, name },
  });

  const synced: Reservation[] = [];
  const skipped: string[] = [];

  for (const b of bookings) {
    if (!b.checkin || !b.checkout) {
      skipped.push(b.bookingId);
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

    // The sheet names one guest per booking — the primary. Any additional pax
    // are collected by the front desk via /:id/guests, so this only ever
    // touches the primary link and leaves those alone.
    const { salutation, lastName } = parseGuestName(b.guestName);
    if (lastName) {
      const existingLink = await db.reservationGuest.findFirst({
        where: { reservationId: reservation.id, role: GuestRole.primary },
      });

      if (existingLink) {
        await db.guest.update({
          where: { id: existingLink.guestId },
          data: { salutation, lastName },
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

  return { synced, skipped };
}
