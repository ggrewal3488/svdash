/**
 * StayVista Master backend — Google Apps Script.
 *
 * DEPLOY:
 * 1. Open the Google Sheet already bound to the live /exec URL used by the
 *    Master Android app and the TV boxes.
 * 2. Extensions > Apps Script. Replace the entire contents of Code.gs with
 *    this file.
 * 3. Change SECRET and SALT below to your own random strings before you
 *    deploy (anything long/random works — just keep them private, don't
 *    reuse the placeholders).
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
 *   GET  ?room=ALL                    -> all occupied rooms, unauthenticated
 *   GET  ?room=<no>                   -> one room's guest data, unauthenticated
 *   GET  ?action=verify&token=...     -> { ok, username, role }
 *   GET  ?action=listUsers&token=...  -> admin only
 *   POST { action: 'login', ... }
 *   POST { action: 'createUser', ... } -> admin only
 *   POST { roomNo, ... }              -> push/overwrite a room's guest (action omitted or 'pushGuest')
 */

var SECRET = 'CHANGE-ME-BEFORE-DEPLOYING-A-LONG-RANDOM-STRING';
var SALT = 'CHANGE-ME-TOO-ANOTHER-RANDOM-STRING';
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
    if (params.room === 'ALL') {
      return json_(getAllRoomsJson_());
    }
    if (params.room) {
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
    switch (body.action) {
      case 'login':
        return json_(login_(body.username, body.password));
      case 'createUser':
        return json_(createUser_(body));
      default:
        return json_(pushGuest_(body));
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
