/**
 * StayVista Master backend — Google Apps Script.
 *
 * DEPLOY:
 * 1. Open the Google Sheet already bound to the live /exec URL used by the
 *    Master Android app and the TV boxes.
 * 2. Extensions > Apps Script. Replace the entire contents of Code.gs with
 *    this file.
 * 3. Change SECRET, SALT and DEVICE_KEY below to your own random strings
 *    before you deploy (anything long/random works — just keep them
 *    private, don't reuse the placeholders, and don't commit the real
 *    values back to git). DEVICE_KEY must also be set as a GitHub Actions
 *    repo secret of the same name, since it's what lets the TV app and the
 *    Master app's unauthenticated calls (guest push, in-house list) reach
 *    ?room=... without a login — see DEVICE_KEY's own comment below.
 * 4. Deploy > Manage deployments > the existing deployment > Edit (pencil
 *    icon) > Version: New version > Deploy. This keeps the same /exec URL
 *    that's already hardcoded in the Android app, the TV sync, and
 *    master/web/app.js — nothing else needs to change.
 * 5. The first call to any endpoint auto-creates "Guests" and "Users"
 *    sheets and seeds one admin account: ggrewal / 12345678. Log in with
 *    that account in the web dashboard and add real accounts from the
 *    Users tab.
 *
 * Endpoints (all on the one /exec URL):
 *   GET  ?room=ALL&(token=...|key=...)     -> all occupied rooms
 *   GET  ?room=<no>&(token=...|key=...)    -> one room's guest data
 *   GET  ?action=verify&token=...          -> { ok, username, role }
 *   GET  ?action=listUsers&token=...       -> admin only
 *   GET  ?action=getPromos                 -> active promo images (id, url, hash, order), unauthenticated
 *   POST { action: 'login', ... }
 *   POST { action: 'createUser', ... }     -> admin only
 *   POST { action: 'pushPromo', imageBase64, mimeType, filename, token? } -> add a promo image (max 5 active)
 *   POST { action: 'deletePromo', id, token? } -> remove a promo image
 *   POST { action: 'logRoomStatus', roomNo, previousStatus, newStatus, username, role, key|token }
 *                                           -> append a row to the HK Log sheet (server/'s room status changes)
 *   POST { roomNo, ... }                   -> push/overwrite a room's guest (action omitted or 'pushGuest')
 *   GET  ?action=getBookings&(token=...|key=...) -> the Bookings tab, for the Master API's reservation sync
 */

var SECRET = 'CHANGE-ME-BEFORE-DEPLOYING-A-LONG-RANDOM-STRING';
var SALT = 'CHANGE-ME-TOO-ANOTHER-RANDOM-STRING';
// Shared secret for callers that can't log in (the TV app's guest-data
// poll, the Master app's unauthenticated guest push/in-house list). A
// valid session token also satisfies this check, so logged-in Master web
// users never need to know it. Never committed to git as a real value --
// the apps get it injected at build time from a DEVICE_KEY CI secret,
// same pattern as the release-signing keystore.
var DEVICE_KEY = 'CHANGE-ME-DEVICE-KEY-BEFORE-DEPLOYING';
var TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    if (params.action === 'verify') {
      var session = verifyToken_(params.token);
      return json_(session ? { ok: true, username: session.username, role: session.role } : { ok: false });
    }
    if (params.action === 'listUsers') {
      var admin = requireAdmin_(params.token);
      if (!admin.ok) return json_(admin);
      return json_({ ok: true, users: listUsers_() });
    }
    if (params.action === 'getPromos') {
      return json_({ ok: true, promos: getPromosJson_() });
    }
    if (params.action === 'getBookings') {
      // Bookings carry guest PII, so gate them like room data rather than
      // leaving them open the way getPromos is.
      if (!isAuthorizedRoomRequest_(params)) return json_({ ok: false, error: 'Unauthorized' });
      return json_({ ok: true, bookings: getBookingsJson_() });
    }
    if (params.room === 'ALL') {
      if (!isAuthorizedRoomRequest_(params)) return json_({ ok: false, error: 'Unauthorized' });
      return json_(getAllRoomsJson_());
    }
    if (params.room) {
      if (!isAuthorizedRoomRequest_(params)) return json_({ ok: false, error: 'Unauthorized' });
      return json_(getRoomJson_(params.room));
    }
    return json_({ ok: false, error: 'Missing room or action parameter' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Invalid JSON body' });
  }

  try {
    // action omitted entirely is the Master app's original, still-supported
    // shape for a guest push ("POST { roomNo, ... }", no action field) — that
    // one case falls through deliberately. Any other, unrecognized action
    // string is a caller error, not silently treated as pushGuest_: an older
    // deployment doesn't know a newer client's action names, and getting it
    // wrong would mean overwriting a room's real guest data with whatever
    // partial body that action sent, which is exactly what happened here
    // once (see git log around 2026-08-25's RBAC/HK-log commit) before this
    // check existed — undeployed logRoomStatus calls silently fell through
    // to pushGuest_ and blanked a room's row.
    switch (body.action) {
      case undefined:
      case 'pushGuest':
        return json_(pushGuest_(body));
      case 'login':
        return json_(login_(body.username, body.password));
      case 'createUser':
        return json_(createUser_(body));
      case 'pushPromo':
        return json_(pushPromo_(body));
      case 'deletePromo':
        return json_(deletePromo_(body));
      case 'logRoomStatus':
        return json_(logRoomStatus_(body));
      default:
        return json_({ ok: false, error: 'Unrecognized action: ' + body.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ----- Guests ----- */

function pushGuest_(body) {
  // A token is only required if the caller sends one (the web dashboard
  // always does once logged in). The Master Android app posts without a
  // token and keeps working unauthenticated, same as before this change.
  if (body.token) {
    var session = verifyToken_(body.token);
    if (!session) return { ok: false, error: 'Invalid or expired session' };
  }

  var roomNo = String(body.roomNo || '').trim();
  if (!roomNo) return { ok: false, error: 'roomNo is required' };

  var sheet = guestsSheet_();
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === roomNo) { rowIndex = i + 1; break; }
  }

  var row = [
    roomNo,
    body.salutation || '',
    body.lastName || '',
    body.checkin || '',
    body.checkout || '',
    body.message || '',
    new Date().toISOString()
  ];

  if (rowIndex === -1) {
    sheet.appendRow(row);
  } else {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }
  return { ok: true, roomNo: roomNo };
}

function getAllRoomsJson_() {
  var sheet = guestsSheet_();
  var data = sheet.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var roomNo = String(row[0]).trim();
    if (!roomNo || !row[2]) continue; // skip blank rows / rooms with no guest
    out[roomNo] = {
      guest: {
        salutation: row[1],
        lastName: row[2],
        checkin: row[3],
        checkout: row[4],
        message: row[5]
      }
    };
  }
  return out;
}

function getRoomJson_(roomNo) {
  roomNo = String(roomNo).trim();
  var sheet = guestsSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === roomNo) {
      var row = data[i];
      return {
        roomNo: roomNo,
        salutation: row[1],
        lastName: row[2],
        checkin: row[3],
        checkout: row[4],
        message: row[5]
      };
    }
  }
  return { roomNo: roomNo };
}

/* ----- Housekeeping log ----- */

// Every room status change from server/'s /rooms endpoints, any role that
// can reach them (Admin, FrontDesk, Housekeeping) — an audit trail on the
// same Hotel DB sheet everything else lives on, not just Housekeeping's own
// actions, so Front Desk/Admin touching room status shows up here too.
function logRoomStatus_(body) {
  if (!isAuthorizedDeviceRequest_(body)) return { ok: false, error: 'Unauthorized' };

  var roomNo = String(body.roomNo || '').trim();
  if (!roomNo) return { ok: false, error: 'roomNo is required' };

  hkLogSheet_().appendRow([
    new Date().toISOString(),
    roomNo,
    body.previousStatus || '',
    body.newStatus || '',
    body.username || '',
    body.role || ''
  ]);
  return { ok: true };
}

/* ----- Promos ----- */

var MAX_ACTIVE_PROMOS = 5;
var MAX_PROMO_BYTES = 5 * 1024 * 1024; // 5MB
var ALLOWED_PROMO_MIME_TYPES = ['image/jpeg', 'image/png'];

function pushPromo_(body) {
  var session = body.token ? verifyToken_(body.token) : null;
  if (body.token && !session) return { ok: false, error: 'Invalid or expired session' };

  var mimeType = String(body.mimeType || '').toLowerCase();
  if (ALLOWED_PROMO_MIME_TYPES.indexOf(mimeType) === -1) {
    return { ok: false, error: 'Image must be JPG or PNG' };
  }

  var base64 = String(body.imageBase64 || '');
  if (!base64) return { ok: false, error: 'imageBase64 is required' };

  var bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (err) {
    return { ok: false, error: 'imageBase64 is not valid base64' };
  }
  if (bytes.length > MAX_PROMO_BYTES) {
    return { ok: false, error: 'Image exceeds the 5MB size limit' };
  }

  var sheet = promosSheet_();
  var data = sheet.getDataRange().getValues();
  var activeCount = 0;
  var maxOrder = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][7] === true) activeCount++;
    var order = Number(data[i][2]) || 0;
    if (order > maxOrder) maxOrder = order;
  }
  if (activeCount >= MAX_ACTIVE_PROMOS) {
    return { ok: false, error: 'Maximum of 5 promotional images already uploaded — delete one first' };
  }

  var filename = String(body.filename || 'promo') + '-' + new Date().getTime();
  var blob = Utilities.newBlob(bytes, mimeType, filename);
  var file = promosFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var id = file.getId();
  var url = 'https://drive.google.com/uc?export=view&id=' + id;
  var hash = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
  var uploadedBy = session ? session.username : 'master-app';

  sheet.appendRow([id, url, maxOrder + 1, hash, mimeType, uploadedBy, new Date().toISOString(), true]);
  return { ok: true, id: id, url: url };
}

function deletePromo_(body) {
  var session = body.token ? verifyToken_(body.token) : null;
  if (body.token && !session) return { ok: false, error: 'Invalid or expired session' };

  var id = String(body.id || '').trim();
  if (!id) return { ok: false, error: 'id is required' };

  var sheet = promosSheet_();
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) { rowIndex = i + 1; break; }
  }
  if (rowIndex === -1) return { ok: false, error: 'Promo not found' };

  sheet.deleteRow(rowIndex);
  try {
    DriveApp.getFileById(id).setTrashed(true);
  } catch (err) {
    // File may already be gone from Drive; the sheet row is the source of truth.
  }
  return { ok: true };
}

function getPromosJson_() {
  var sheet = promosSheet_();
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[7] !== true) continue; // active only
    out.push({ id: row[0], url: row[1], order: Number(row[2]) || 0, hash: row[3] });
  }
  out.sort(function (a, b) { return a.order - b.order; });
  return out.slice(0, MAX_ACTIVE_PROMOS);
}

function promosFolder_() {
  var name = 'SVDash Promos';
  var folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

function promosSheet_() {
  return getOrCreateSheet_('Promos', ['Id', 'Url', 'Order', 'Hash', 'MimeType', 'UploadedBy', 'UploadedAt', 'Active']);
}

/* ----- Auth / users ----- */

function login_(username, password) {
  username = String(username || '').trim();
  if (!username || !password) return { ok: false, error: 'Username and password are required' };

  var sheet = usersSheet_();
  var data = sheet.getDataRange().getValues();
  var hash = hashPassword_(password);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === username.toLowerCase()) {
      if (data[i][1] !== hash) return { ok: false, error: 'Invalid username or password' };
      var role = data[i][2];
      return { ok: true, username: data[i][0], role: role, token: makeToken_(data[i][0], role) };
    }
  }
  return { ok: false, error: 'Invalid username or password' };
}

function createUser_(body) {
  var admin = requireAdmin_(body.token);
  if (!admin.ok) return admin;

  var username = String(body.newUsername || '').trim();
  var password = body.newPassword || '';
  var role = body.role;

  if (!username || !password) return { ok: false, error: 'Username and password are required' };
  if (role !== 'User' && role !== 'Admin') return { ok: false, error: 'Role must be User or Admin' };

  var sheet = usersSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === username.toLowerCase()) {
      return { ok: false, error: 'Username already exists' };
    }
  }

  sheet.appendRow([username, hashPassword_(password), role, new Date().toISOString()]);
  return { ok: true };
}

function listUsers_() {
  var sheet = usersSheet_();
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    out.push({ username: data[i][0], role: data[i][2], createdAt: data[i][3] });
  }
  return out;
}

/**
 * Gate for ?room=... : a valid logged-in session, OR the shared device key
 * that ships baked into the TV app / Master app builds. Either is enough --
 * this isn't role-based, just "not a random caller on the public internet".
 */
function isAuthorizedRoomRequest_(params) {
  if (params.key && params.key === DEVICE_KEY) return true;
  if (params.token && verifyToken_(params.token)) return true;
  return false;
}

// Same gate as isAuthorizedRoomRequest_, but for a POST body (server-to-server
// calls, like the Master API's HK status log, send the device key in the
// JSON body rather than a query param).
function isAuthorizedDeviceRequest_(body) {
  if (body.key && body.key === DEVICE_KEY) return true;
  if (body.token && verifyToken_(body.token)) return true;
  return false;
}

function requireAdmin_(token) {
  var session = verifyToken_(token);
  if (!session) return { ok: false, error: 'Not authenticated' };
  if (session.role !== 'Admin') return { ok: false, error: 'Forbidden' };
  return { ok: true, session: session };
}

/* ----- Sheets ----- */

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function guestsSheet_() {
  return getOrCreateSheet_('Guests', ['RoomNo', 'Salutation', 'LastName', 'Checkin', 'Checkout', 'Message', 'UpdatedAt']);
}

function hkLogSheet_() {
  return getOrCreateSheet_('HK Log', ['Timestamp', 'RoomNo', 'PreviousStatus', 'NewStatus', 'Username', 'Role']);
}

function bookingsSheet_() {
  // BD is auto-populated from the property's channel manager — it replaced
  // the hand-maintained Bookings tab as the sync source. Left as a separate
  // getOrCreateSheet_ call (rather than renaming in place) so an existing
  // Bookings tab from before this change is untouched, just no longer read.
  return getOrCreateSheet_('BD', [
    'Booking ID', 'Guest Name', 'Room Type', 'Check-In', 'Check-Out',
    'Pax', 'Primary Source', 'Secondary Source', 'Booking Status'
  ]);
}

/**
 * The BD tab, normalised for the Master API's /reservations/sync.
 *
 * Dates are emitted as yyyy-MM-dd strings: a date-formatted cell arrives here
 * as a Date, a hand-typed one as a string, and the API should not have to care
 * which. Rows without a Booking ID are skipped — that's the blank-row case,
 * same convention getAllRoomsJson_ uses for rooms with no guest. Which
 * Booking Status values to actually sync is a call for syncReservations.ts,
 * not this bridge — every row is passed through as-is.
 */
function getBookingsJson_() {
  var sheet = bookingsSheet_();
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var bookingId = String(row[0] || '').trim();
    if (!bookingId) continue;
    out.push({
      bookingId: bookingId,
      guestName: String(row[1] || '').trim(),
      roomType: String(row[2] || '').trim(),
      checkin: toSheetDate_(row[3]),
      checkout: toSheetDate_(row[4]),
      pax: paxOrNull_(row[5]),
      sourcePrimary: String(row[6] || '').trim(),
      sourceSecondary: String(row[7] || '').trim(),
      bookingStatus: String(row[8] || '').trim()
    });
  }
  return out;
}

function toSheetDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function paxOrNull_(value) {
  var n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

function usersSheet_() {
  var sheet = getOrCreateSheet_('Users', ['Username', 'PasswordHash', 'Role', 'CreatedAt']);
  if (sheet.getLastRow() < 2) {
    sheet.appendRow(['ggrewal', hashPassword_('12345678'), 'Admin', new Date().toISOString()]);
  }
  return sheet;
}

/* ----- Crypto helpers ----- */

function hashPassword_(pw) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw + SALT);
  return bytesToHex_(digest);
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) {
    b = (b < 0) ? b + 256 : b;
    var hex = b.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function makeToken_(username, role) {
  var expiry = Date.now() + TOKEN_TTL_MS;
  var payload = username + '|' + role + '|' + expiry;
  var payloadB64 = Utilities.base64EncodeWebSafe(payload);
  var sigB64 = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, SECRET));
  return payloadB64 + '.' + sigB64;
}

function verifyToken_(token) {
  if (!token || token.indexOf('.') === -1) return null;
  var parts = token.split('.');
  var payloadB64 = parts[0], sigB64 = parts[1];
  var payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadB64)).getDataAsString();
  } catch (e) {
    return null;
  }
  var expectedSig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, SECRET));
  if (expectedSig !== sigB64) return null;

  var bits = payload.split('|');
  if (bits.length !== 3) return null;
  var username = bits[0], role = bits[1], expiry = Number(bits[2]);
  if (!expiry || Date.now() > expiry) return null;
  return { username: username, role: role };
}

/* ----- Response ----- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
