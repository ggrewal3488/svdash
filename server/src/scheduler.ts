import { syncReservations } from "./services/syncReservations";

/**
 * Periodic pull of the Bookings tab, so a booking added to the sheet reaches
 * the front desk without anyone remembering to POST /reservations/sync.
 *
 * Set SYNC_INTERVAL_MINUTES to 0 to disable (useful in dev, where a stray
 * timer hitting the live sheet is the last thing you want).
 */
export function startSyncScheduler(): NodeJS.Timeout | null {
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 15);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log("sync scheduler disabled (SYNC_INTERVAL_MINUTES <= 0)");
    return null;
  }

  let running = false;
  const tick = async () => {
    // A slow sheet fetch must not stack overlapping runs on top of each other;
    // they'd race on the same upserts.
    if (running) {
      console.warn("sync still running, skipping this tick");
      return;
    }
    running = true;
    try {
      const { synced, skipped } = await syncReservations();
      console.log(`scheduled sync: ${synced.length} reservations, ${skipped.length} skipped`);
    } catch (err) {
      // Never rethrow: an unhandled rejection in a timer takes the process
      // down, and one bad sheet read shouldn't stop the front desk working.
      console.error("scheduled sync failed:", err);
    } finally {
      running = false;
    }
  };

  console.log(`sync scheduler running every ${minutes} min`);
  const timer = setInterval(tick, minutes * 60 * 1000);
  // Don't hold the event loop open on shutdown.
  timer.unref();
  void tick();
  return timer;
}
