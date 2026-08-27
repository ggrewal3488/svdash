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
 *   GET  ?action=listHousekeeping&token=... -> current status per room + recent log entries
 *   GET  ?action=listMaintenance&token=...  -> current status per ticket + recent log entries
 *   POST { action: 'login', ... }
 *   POST { action: 'createUser', ... }     -> admin only
 *   POST { action: 'pushPromo', imageBase64, mimeType, filename, token? } -> add a promo image (max 5 active)
 *   POST { action: 'deletePromo', id, token? } -> remove a promo image
 *   POST { action: 'updateHousekeeping', roomNo, status, notes?, token } -> Admin/Housekeeping only, appends to the log
 *   POST { action: 'createMaintenanceTicket', location, issue, token } -> any role, opens a ticket
 *   POST { action: 'updateMaintenanceTicket', ticketId, status, notes?, token } -> any role, advances a ticket
 *   POST { roomNo, ... }                   -> push/overwrite a room's guest (action omitted or 'pushGuest')
 *   GET  ?action=getBookings&(token=...|key=...) -> the Bookings tab, for the Master API's reservation sync
 *
 * Roles: Admin (everything, only role that can create users), Front Desk
 * (guest push, in-house, content -- the old 'User' role, still accepted on
 * login/tokens for accounts created before this rename), Housekeeping (HK
 * tab only), BOH (read-only except Maintenance). Maintenance itself is the
 * one tab every role can both see and write to -- anyone on staff can raise
 * or update a ticket for a room or any other area of the property. See
 * ROLE_CAPS below for the exact capability grants.
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

var ROLES = ['Admin', 'Front Desk', 'Housekeeping', 'BOH'];

// Capability grants per role. 'guests' = Update/In-House tabs (push +
// read), 'promos' = Content tab uploads (reading the promo grid is public,
// unauthenticated -- see getPromosJson_), 'housekeeping' = the HK tab,
// 'users' = the Users tab, 'maintenance' = the Maintenance tab. Every role
// gets *:read implicitly through hasCapability_ below; only the roles
// listed here get *:write. 'maintenance' is intentionally on every role's
// write list -- anyone on staff can raise or update a ticket. Keep in sync
// with ROLE_CAPS in Session.kt.
var ROLE_CAPS = {
  'Admin':         { read: ['guests', 'promos', 'housekeeping', 'users', 'maintenance'], write: ['guests', 'promos', 'housekeeping', 'users', 'maintenance'] },
  'Front Desk':    { read: ['guests', 'promos', 'maintenance'],                          write: ['guests', 'promos', 'maintenance'] },
  'Housekeeping':  { read: ['housekeeping', 'maintenance'],                              write: ['housekeeping', 'maintenance'] },
  'BOH':           { read: ['guests', 'promos', 'housekeeping', 'users', 'maintenance'], write: ['maintenance'] }
};

/** Accounts created before the Front Desk rename still have role 'User' in the sheet. */
function normalizeRole_(role) {
  return role === 'User' ? 'Front Desk' : role;
}

function hasCapability_(role, kind, tab) {
  var caps = ROLE_CAPS[normalizeRole_(role)];
  return !!caps && caps[kind].indexOf(tab) !== -1;
}

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
    if (params.action === 'listHousekeeping') {
      var hk = requireCapability_(params.token, 'read', 'housekeeping');
      if (!hk.ok) return json_(hk);
      return json_({ ok: true, rooms: listHousekeepingRooms_(), log: listHousekeepingLog_() });
    }
    if (params.action === 'listMaintenance') {
      var mnt = requireCapability_(params.token, 'read', 'maintenance');
      if (!mnt.ok) return json_(mnt);
      return json_({ ok: true, tickets: listMaintenanceTickets_(), log: listMaintenanceLog_() });
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
      case 'updateHousekeeping':
        return json_(updateHousekeeping_(body));
      case 'logRoomStatus':
        return json_(logRoomStatus_(body));
      case 'createMaintenanceTicket':
        return json_(createMaintenanceTicket_(body));
      case 'updateMaintenanceTicket':
        return json_(updateMaintenanceTicket_(body));
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
    if (!hasCapability_(session.role, 'write', 'guests')) return { ok: false, error: 'Forbidden' };
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
  if (session && !hasCapability_(session.role, 'write', 'promos')) return { ok: false, error: 'Forbidden' };

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
  if (session && !hasCapability_(session.role, 'write', 'promos')) return { ok: false, error: 'Forbidden' };

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
      var role = normalizeRole_(data[i][2]);
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
  if (ROLES.indexOf(role) === -1) return { ok: false, error: 'Role must be one of: ' + ROLES.join(', ') };

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
    out.push({ username: data[i][0], role: normalizeRole_(data[i][2]), createdAt: data[i][3] });
  }
  return out;
}

/**
 * Gate for ?room=... and ?action=getBookings : the shared device key that
 * ships baked into the TV app / Master app builds (unauthenticated calls,
 * not tied to a person), OR a valid logged-in session with 'guests' read
 * access -- Housekeeping-only accounts don't get this data.
 */
function isAuthorizedRoomRequest_(params) {
  if (params.key && params.key === DEVICE_KEY) return true;
  if (params.token) {
    var session = verifyToken_(params.token);
    if (session && hasCapability_(session.role, 'read', 'guests')) return true;
  }
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
  if (normalizeRole_(session.role) !== 'Admin') return { ok: false, error: 'Forbidden' };
  return { ok: true, session: session };
}

/** Gate for an endpoint behind a role capability, e.g. requireCapability_(token, 'write', 'housekeeping'). */
function requireCapability_(token, kind, tab) {
  var session = verifyToken_(token);
  if (!session) return { ok: false, error: 'Not authenticated' };
  if (!hasCapability_(session.role, kind, tab)) return { ok: false, error: 'Forbidden' };
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

/* ----- Housekeeping ----- */

var HK_STATUSES = ['Vacant Ready', 'Vacant Dirty', 'Occupied', 'Maintenance', 'Out of Order'];
var HK_LOG_LIMIT = 100;

/**
 * Append-only log, same pattern as Guests but never overwritten in place --
 * the point of this tab is a history of who set what status when, for both
 * room attendants and their supervisor. "Current" status per room is
 * derived by scanning for each room's most recent row (see
 * listHousekeepingRooms_), not stored separately.
 */
function housekeepingSheet_() {
  return getOrCreateSheet_('Housekeeping', ['Timestamp', 'RoomNo', 'Status', 'UpdatedBy', 'Notes']);
}

function updateHousekeeping_(body) {
  var access = requireCapability_(body.token, 'write', 'housekeeping');
  if (!access.ok) return access;

  var roomNo = String(body.roomNo || '').trim();
  if (!roomNo) return { ok: false, error: 'roomNo is required' };

  var status = String(body.status || '').trim();
  if (HK_STATUSES.indexOf(status) === -1) return { ok: false, error: 'Status must be one of: ' + HK_STATUSES.join(', ') };

  var notes = String(body.notes || '').trim();
  housekeepingSheet_().appendRow([new Date().toISOString(), roomNo, status, access.session.username, notes]);
  return { ok: true };
}

function listHousekeepingRooms_() {
  var data = housekeepingSheet_().getDataRange().getValues();
  var byRoom = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var roomNo = String(row[1] || '').trim();
    if (!roomNo) continue;
    // Rows are appended in chronological order, so the last one seen per
    // room is always its most recent status.
    byRoom[roomNo] = { roomNo: roomNo, status: row[2], updatedBy: row[3], updatedAt: row[0] };
  }
  var rooms = Object.keys(byRoom).map(function (roomNo) { return byRoom[roomNo]; });
  rooms.sort(function (a, b) {
    var an = Number(a.roomNo), bn = Number(b.roomNo);
    if (!isNaN(an) && !isNaN(bn)) return an - bn;
    return a.roomNo < b.roomNo ? -1 : a.roomNo > b.roomNo ? 1 : 0;
  });
  return rooms;
}

/** Most recent entries first, for an activity feed alongside the current-status board. */
function listHousekeepingLog_() {
  var data = housekeepingSheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[1]) continue;
    out.push({ timestamp: row[0], roomNo: row[1], status: row[2], updatedBy: row[3], notes: row[4] });
  }
  out.reverse();
  return out.slice(0, HK_LOG_LIMIT);
}

/* ----- Maintenance tickets ----- */

var MAINTENANCE_STATUSES = ['Open', 'In Progress', 'Resolved'];
var MAINTENANCE_LOG_LIMIT = 100;

/**
 * Append-only, same pattern as the Housekeeping sheet: every create/update
 * is a new row keyed by TicketId, and "current" status per ticket is the
 * most recent row seen for that id (see listMaintenanceTickets_). Location
 * is free text -- a room number or any other area of the property -- not
 * validated against the room list, since a ticket can be raised for
 * anywhere (lobby, pool, server room, ...).
 */
function maintenanceSheet_() {
  return getOrCreateSheet_('Maintenance', ['Timestamp', 'TicketId', 'Location', 'Issue', 'Status', 'UpdatedBy', 'Role', 'Notes']);
}

function createMaintenanceTicket_(body) {
  var access = requireCapability_(body.token, 'write', 'maintenance');
  if (!access.ok) return access;

  var location = String(body.location || '').trim();
  if (!location) return { ok: false, error: 'Location is required' };

  var issue = String(body.issue || '').trim();
  if (!issue) return { ok: false, error: 'Issue description is required' };

  var ticketId = 'MT-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  maintenanceSheet_().appendRow([new Date().toISOString(), ticketId, location, issue, 'Open', access.session.username, access.session.role, '']);
  return { ok: true, ticketId: ticketId };
}

/** status advances a ticket; location/issue always carry forward from the ticket's first row. */
function updateMaintenanceTicket_(body) {
  var access = requireCapability_(body.token, 'write', 'maintenance');
  if (!access.ok) return access;

  var ticketId = String(body.ticketId || '').trim();
  if (!ticketId) return { ok: false, error: 'ticketId is required' };

  var status = String(body.status || '').trim();
  if (MAINTENANCE_STATUSES.indexOf(status) === -1) return { ok: false, error: 'Status must be one of: ' + MAINTENANCE_STATUSES.join(', ') };

  var data = maintenanceSheet_().getDataRange().getValues();
  var location = '', issue = '';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === ticketId) { location = data[i][2]; issue = data[i][3]; }
  }
  if (!location) return { ok: false, error: 'Ticket not found' };

  var notes = String(body.notes || '').trim();
  maintenanceSheet_().appendRow([new Date().toISOString(), ticketId, location, issue, status, access.session.username, access.session.role, notes]);
  return { ok: true };
}

function listMaintenanceTickets_() {
  var data = maintenanceSheet_().getDataRange().getValues();
  var byTicket = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var ticketId = String(row[1] || '').trim();
    if (!ticketId) continue;
    // Rows are appended in chronological order, so the last one seen per
    // ticket is always its most recent state.
    byTicket[ticketId] = {
      ticketId: ticketId,
      location: row[2],
      issue: row[3],
      status: row[4],
      updatedBy: row[5],
      updatedAt: row[0]
    };
  }
  var tickets = Object.keys(byTicket).map(function (id) { return byTicket[id]; });
  tickets.sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
  return tickets;
}

/** Most recent entries first, for an activity feed alongside the open-tickets board. */
function listMaintenanceLog_() {
  var data = maintenanceSheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[1]) continue;
    out.push({ timestamp: row[0], ticketId: row[1], location: row[2], issue: row[3], status: row[4], updatedBy: row[5], notes: row[7] });
  }
  out.reverse();
  return out.slice(0, MAINTENANCE_LOG_LIMIT);
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
  return { username: username, role: normalizeRole_(role) };
}

/* ----- Response ----- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
