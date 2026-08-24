import { Router } from "express";
import { getSheetRoom, pushGuestToSheet } from "../bridge/pushToSheet";

// Manual override for the guest->TV bridge — the same pushGuest_ write path
// server/'s check-in flow already uses automatically, exposed directly for
// cases outside the normal reservation flow (a walk-in, a correction, a
// message-only update). Mirrors master/web's "Update" tab, including the
// overwrite-confirm lookup before a push.
export const tvRouter = Router();

tvRouter.get("/:roomNo", async (req, res) => {
  try {
    const room = await getSheetRoom(req.params.roomNo);
    res.json({ ok: true, room });
  } catch (err) {
    console.error("TV room lookup failed:", err);
    res.status(502).json({ ok: false, error: "room lookup failed" });
  }
});

tvRouter.post("/:roomNo", async (req, res) => {
  const lastName = String(req.body?.lastName ?? "").trim();
  if (!lastName) {
    res.status(400).json({ ok: false, error: "lastName is required" });
    return;
  }

  try {
    await pushGuestToSheet({
      roomNo: req.params.roomNo,
      salutation: req.body?.salutation ? String(req.body.salutation) : undefined,
      lastName,
      checkin: req.body?.checkin ? String(req.body.checkin) : undefined,
      checkout: req.body?.checkout ? String(req.body.checkout) : undefined,
      message: req.body?.message ? String(req.body.message) : undefined,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("TV push failed:", err);
    res.status(502).json({ ok: false, error: "TV push failed" });
  }
});
