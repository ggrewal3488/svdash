import { Router } from "express";
import { db } from "../db";

export const cardsRouter = Router();

cardsRouter.get("/:id", async (req, res) => {
  try {
    const card = await db.card.findUnique({
      where: { id: req.params.id },
      include: { guest: true, room: true },
    });
    if (!card) {
      res.status(404).json({ ok: false, error: "card not found" });
      return;
    }
    res.json({ ok: true, card });
  } catch (err) {
    console.error("get card failed:", err);
    res.status(500).json({ ok: false, error: "get card failed" });
  }
});

// Front desk revoking a card by hand — lost, replaced, or anything that
// needs the room re-keyed outside a normal check-out (which already revokes
// a reservation's cards on its own).
cardsRouter.post("/:id/revoke", async (req, res) => {
  try {
    const card = await db.card.findUnique({ where: { id: req.params.id } });
    if (!card) {
      res.status(404).json({ ok: false, error: "card not found" });
      return;
    }
    if (card.status === "revoked") {
      res.status(409).json({ ok: false, error: "card is already revoked" });
      return;
    }

    const updated = await db.card.update({
      where: { id: card.id },
      data: { status: "revoked" },
    });
    res.json({ ok: true, card: updated });
  } catch (err) {
    console.error("revoke card failed:", err);
    res.status(500).json({ ok: false, error: "revoke card failed" });
  }
});
