import { Readable } from "stream";
import { google } from "googleapis";

// Uploads scanned ID documents into a Drive folder shared with a service
// account — the operator's own choice for where this sensitive PII lives
// (see the "ID document handling" risk in the Master Platform Blueprint).
// Neither the folder nor a real service account key exists in this repo:
// GOOGLE_SERVICE_ACCOUNT_KEY / ID_SCAN_DRIVE_FOLDER_ID must be set for this
// to do anything (see .env.example) — the service account also has to be
// shared on that folder as a Content Manager, the same as sharing it with a
// person.
//
// Compliance decisions (2026-08-24): access control is exactly Drive's own
// folder sharing — whoever is added to ID_SCAN_DRIVE_FOLDER_ID can see the
// scans, no separate app-level ACL. Encryption at rest is Drive's own
// infrastructure (AES-256), not something this app does. Retention is
// indefinite/manual — no auto-delete job — so removing a scan is on
// whoever manages that folder.
const FOLDER_ID = process.env.ID_SCAN_DRIVE_FOLDER_ID ?? "";

function driveClient() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set — see server/.env.example");
  }
  if (!FOLDER_ID) {
    throw new Error("ID_SCAN_DRIVE_FOLDER_ID is not set — see server/.env.example");
  }

  // Stored as the raw JSON key (not a file path): this API runs on hosts
  // where dropping a credentials file on disk isn't guaranteed, same reason
  // MASTER_API_KEY is a value rather than a path.
  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  return google.drive({ version: "v3", auth });
}

export interface UploadedScan {
  fileId: string;
  webViewLink: string;
}

export async function uploadIdScan(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<UploadedScan> {
  const drive = driveClient();

  const res = await drive.files.create({
    requestBody: { name: filename, parents: [FOLDER_ID] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id, webViewLink",
  });

  const fileId = res.data.id;
  const webViewLink = res.data.webViewLink;
  if (!fileId || !webViewLink) {
    throw new Error("Drive upload did not return a file id/link");
  }
  return { fileId, webViewLink };
}
