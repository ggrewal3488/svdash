import { Router } from "express";
import multer from "multer";
import { db } from "../db";
import { uploadIdScan } from "../driveClient";

export const idDocumentsRouter = Router();

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // a phone photo or a scanned PDF, not a video
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIME.has(file.mimetype));
  },
});

// Split from POST /reservations/:id/guests (which creates the IdDocument
// row with just the typed-in fields) because the row has to exist before a
// file can be attached to it, and because a Drive upload can fail for
// reasons unrelated to whether the guest's details were valid — the two
// shouldn't roll back together.
idDocumentsRouter.post("/:id/scan", upload.single("scan"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({
      ok: false,
      error: "scan file is required (jpeg/png/webp/pdf, up to 15MB)",
    });
    return;
  }

  try {
    const idDocument = await db.idDocument.findUnique({ where: { id: req.params.id } });
    if (!idDocument) {
      res.status(404).json({ ok: false, error: "ID document not found" });
      return;
    }

    const ext = req.file.originalname.split(".").pop() || "bin";
    const filename = `${idDocument.id}-${idDocument.idType}.${ext}`;
    const { webViewLink } = await uploadIdScan(req.file.buffer, filename, req.file.mimetype);

    const updated = await db.idDocument.update({
      where: { id: idDocument.id },
      data: { scanRef: webViewLink },
    });

    res.json({ ok: true, idDocument: updated });
  } catch (err) {
    console.error("ID scan upload failed:", err);
    res.status(502).json({ ok: false, error: "upload failed — Drive may not be configured yet" });
  }
});
