/* StayVista Master dashboard */

var API_URL = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec";
var SESSION_KEY = "svMasterSession";

var session = null;      // { token, username, role }
var pendingPush = null;  // form data waiting on the overwrite confirmation

document.addEventListener("DOMContentLoaded", init);

function init() {
    wireLogin();
    wireDashboard();
    wireOverwriteModal();
    restoreSession();
}

/* ----- API helpers -----
 * POST bodies are sent with the default (text/plain) request Content-Type
 * on purpose -- a custom header would trigger a CORS preflight, which Apps
 * Script web apps don't handle. The server still parses the body as JSON.
 */
function apiGet(params) {
    var qs = Object.keys(params)
        .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
        .join("&");
    return fetch(API_URL + "?" + qs).then(function (r) { return r.json(); });
}

function apiPost(body) {
    return fetch(API_URL, { method: "POST", body: JSON.stringify(body) })
        .then(function (r) { return r.json(); });
}

/* ----- Session ----- */
function restoreSession() {
    var raw = localStorage.getItem(SESSION_KEY);
    if (!raw) { showLogin(); return; }

    var stored;
    try { stored = JSON.parse(raw); } catch (e) { showLogin(); return; }

    apiGet({ action: "verify", token: stored.token }).then(function (res) {
        if (res.ok) {
            session = { token: stored.token, username: res.username, role: res.role };
            showDashboard();
        } else {
            localStorage.removeItem(SESSION_KEY);
            showLogin();
        }
    }).catch(function () { showLogin(); });
}

function setSession(newSession) {
    session = newSession;
    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
}

function clearSession() {
    session = null;
    localStorage.removeItem(SESSION_KEY);
}

/* ----- Login ----- */
function wireLogin() {
    document.getElementById("login-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var username = document.getElementById("login-username").value.trim();
        var password = document.getElementById("login-password").value;
        var btn = document.getElementById("login-btn");
        var errEl = document.getElementById("login-error");
        errEl.textContent = "";

        btn.disabled = true;
        apiPost({ action: "login", username: username, password: password })
            .then(function (res) {
                if (res.ok) {
                    setSession({ token: res.token, username: res.username, role: res.role });
                    showDashboard();
                } else {
                    errEl.textContent = res.error || "Login failed";
                }
            })
            .catch(function () { errEl.textContent = "Network error — try again"; })
            .finally(function () { btn.disabled = false; });
    });
}

function showLogin() {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");
}

function showDashboard() {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    document.getElementById("user-label").textContent = session.username + " · " + session.role;

    var usersTab = document.querySelector('.tab-btn[data-tab="users"]');
    if (session.role === "Admin") usersTab.classList.remove("hidden");
    else usersTab.classList.add("hidden");

    loadInHouse();
}

/* ----- Dashboard shell / tabs ----- */
function wireDashboard() {
    document.getElementById("logout-btn").addEventListener("click", function () {
        clearSession();
        document.getElementById("login-form").reset();
        showLogin();
    });

    document.querySelectorAll(".tab-btn").forEach(function (btn) {
        btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
    });

    document.getElementById("update-form").addEventListener("submit", onUpdateSubmit);
    document.getElementById("refresh-inhouse").addEventListener("click", loadInHouse);
    document.getElementById("refresh-users").addEventListener("click", loadUsers);
    document.getElementById("add-user-form").addEventListener("submit", onAddUserSubmit);
    document.getElementById("refresh-promos").addEventListener("click", loadPromos);
    document.getElementById("promo-file-input").addEventListener("change", onPromoFileSelected);
}

function switchTab(name) {
    document.querySelectorAll(".tab-btn").forEach(function (b) {
        b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) {
        p.classList.toggle("hidden", p.id !== "tab-" + name);
    });
    if (name === "inhouse") loadInHouse();
    if (name === "users") loadUsers();
    if (name === "content") loadPromos();
}

/* ----- Update tab ----- */
function onUpdateSubmit(e) {
    e.preventDefault();
    var roomNo = document.getElementById("f-roomNo").value.trim();
    var statusEl = document.getElementById("update-status");
    if (!roomNo) return;

    var data = {
        roomNo: roomNo,
        salutation: document.getElementById("f-salutation").value,
        lastName: document.getElementById("f-lastName").value.trim(),
        checkin: document.getElementById("f-checkin").value,
        checkout: document.getElementById("f-checkout").value,
        message: document.getElementById("f-message").value.trim()
    };

    setStatus(statusEl, "Checking room…", "");
    apiGet({ room: roomNo, token: session.token }).then(function (existing) {
        if (existing && existing.lastName) {
            openOverwriteModal(existing, data);
            setStatus(statusEl, "", "");
        } else {
            pushGuest(data, statusEl);
        }
    }).catch(function () {
        setStatus(statusEl, "Could not check room — try again", "error");
    });
}

function pushGuest(data, statusEl) {
    setStatus(statusEl, "Pushing…", "");
    var btn = document.getElementById("push-btn");
    btn.disabled = true;

    apiPost(Object.assign({ action: "pushGuest", token: session.token }, data))
        .then(function (res) {
            if (res.ok) {
                setStatus(statusEl, "Room " + data.roomNo + " saved — TV refreshes within a minute", "ok");
                document.getElementById("update-form").reset();
            } else {
                setStatus(statusEl, res.error || "Push failed", "error");
            }
        })
        .catch(function () { setStatus(statusEl, "Network error — try again", "error"); })
        .finally(function () { btn.disabled = false; });
}

function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = "status" + (kind ? " " + kind : "");
}

/* ----- Overwrite modal ----- */
function wireOverwriteModal() {
    var check = document.getElementById("overwrite-confirm-check");
    var confirmBtn = document.getElementById("overwrite-confirm");

    check.addEventListener("change", function () { confirmBtn.disabled = !check.checked; });

    document.getElementById("overwrite-cancel").addEventListener("click", closeOverwriteModal);

    confirmBtn.addEventListener("click", function () {
        var data = pendingPush;
        closeOverwriteModal();
        if (data) pushGuest(data, document.getElementById("update-status"));
    });
}

function openOverwriteModal(existing, newData) {
    pendingPush = newData;
    var name = (existing.salutation || "") + " " + (existing.lastName || "");
    document.getElementById("overwrite-detail").textContent =
        "Room " + newData.roomNo + " currently has " + name.trim() +
        (existing.checkout ? ", checking out " + existing.checkout : "") +
        ". Pushing new details will overwrite this record.";

    var check = document.getElementById("overwrite-confirm-check");
    check.checked = false;
    document.getElementById("overwrite-confirm").disabled = true;
    document.getElementById("overwrite-modal").classList.remove("hidden");
}

function closeOverwriteModal() {
    document.getElementById("overwrite-modal").classList.add("hidden");
    pendingPush = null;
}

/* ----- In-House tab ----- */
function loadInHouse() {
    var content = document.getElementById("inhouse-content");
    if (!session) return;
    content.innerHTML = '<p class="muted">Loading…</p>';

    apiGet({ room: "ALL", token: session.token }).then(function (rooms) {
        renderInHouse(rooms || {});
    }).catch(function () {
        content.innerHTML = '<p class="status error">Could not load guests</p>';
    });
}

function renderInHouse(rooms) {
    var content = document.getElementById("inhouse-content");
    var roomNos = Object.keys(rooms);
    if (roomNos.length === 0) {
        content.innerHTML = '<p class="muted">No guests currently in house</p>';
        return;
    }

    // Floor = first digit of the room number (matches ProvisioningManager's numbering).
    var floors = {};
    roomNos.forEach(function (roomNo) {
        var floor = roomNo.charAt(0);
        (floors[floor] = floors[floor] || []).push(roomNo);
    });

    var floorKeys = Object.keys(floors).sort(function (a, b) { return a - b; });

    var html = "";
    floorKeys.forEach(function (floor) {
        var roomsOnFloor = floors[floor].sort(function (a, b) { return a - b; });
        html += '<div class="floor-group"><h3>Floor ' + floor + '</h3><table>' +
            '<thead><tr><th>Room</th><th>Guest</th><th>Check-in</th><th>Check-out</th><th>Message</th></tr></thead><tbody>';
        roomsOnFloor.forEach(function (roomNo) {
            var g = rooms[roomNo].guest || {};
            var name = ((g.salutation || "") + " " + (g.lastName || "")).trim();
            html += "<tr><td>" + escapeHtml(roomNo) + "</td><td>" + escapeHtml(name) +
                "</td><td>" + escapeHtml(g.checkin || "") + "</td><td>" + escapeHtml(g.checkout || "") +
                "</td><td>" + escapeHtml(g.message || "") + "</td></tr>";
        });
        html += "</tbody></table></div>";
    });

    content.innerHTML = html;
}

/* ----- Content tab (center card promos) ----- */
var PROMO_MAX_BYTES = 5 * 1024 * 1024;
var PROMO_ALLOWED_TYPES = ["image/jpeg", "image/png"];
var PROMO_MAX_ACTIVE = 5;

function loadPromos() {
    var grid = document.getElementById("promo-grid");
    grid.innerHTML = '<p class="muted">Loading…</p>';

    apiGet({ action: "getPromos" }).then(function (res) {
        renderPromoGrid(res.promos || []);
    }).catch(function () {
        grid.innerHTML = '<p class="status error">Could not load content</p>';
    });
}

function renderPromoGrid(promos) {
    var grid = document.getElementById("promo-grid");
    var fileInput = document.getElementById("promo-file-input");

    if (promos.length === 0) {
        grid.innerHTML = '<p class="muted">No promotional images yet — the card just shows the Drawing Room logo.</p>';
    } else {
        grid.innerHTML = promos.map(function (p) {
            return '<div class="promo-card">' +
                '<img src="' + encodeURI(p.url) + '" alt="Promo">' +
                '<div class="promo-card-footer">' +
                '<span class="muted">#' + p.order + '</span>' +
                '<button type="button" class="promo-delete-btn" data-id="' + escapeHtml(p.id) + '">Delete</button>' +
                '</div></div>';
        }).join("");

        grid.querySelectorAll(".promo-delete-btn").forEach(function (btn) {
            btn.addEventListener("click", function () { onDeletePromo(btn.dataset.id); });
        });
    }

    fileInput.disabled = promos.length >= PROMO_MAX_ACTIVE;
}

function onPromoFileSelected(e) {
    var file = e.target.files[0];
    var statusEl = document.getElementById("promo-status");
    if (!file) return;

    if (PROMO_ALLOWED_TYPES.indexOf(file.type) === -1) {
        setStatus(statusEl, "Only JPG or PNG images are allowed", "error");
        e.target.value = "";
        return;
    }
    if (file.size > PROMO_MAX_BYTES) {
        setStatus(statusEl, "Image exceeds the 5MB size limit", "error");
        e.target.value = "";
        return;
    }

    setStatus(statusEl, "Uploading…", "");
    var reader = new FileReader();
    reader.onload = function () {
        var dataUrl = reader.result;
        var base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
        apiPost({
            action: "pushPromo",
            token: session.token,
            imageBase64: base64,
            mimeType: file.type,
            filename: file.name
        }).then(function (res) {
            if (res.ok) {
                setStatus(statusEl, "Uploaded", "ok");
                loadPromos();
            } else {
                setStatus(statusEl, res.error || "Upload failed", "error");
            }
        }).catch(function () {
            setStatus(statusEl, "Network error — try again", "error");
        }).finally(function () { e.target.value = ""; });
    };
    reader.onerror = function () {
        setStatus(statusEl, "Could not read file", "error");
        e.target.value = "";
    };
    reader.readAsDataURL(file);
}

function onDeletePromo(id) {
    var statusEl = document.getElementById("promo-status");
    setStatus(statusEl, "Deleting…", "");
    apiPost({ action: "deletePromo", token: session.token, id: id }).then(function (res) {
        if (res.ok) {
            setStatus(statusEl, "Deleted", "ok");
            loadPromos();
        } else {
            setStatus(statusEl, res.error || "Delete failed", "error");
        }
    }).catch(function () {
        setStatus(statusEl, "Network error — try again", "error");
    });
}

/* ----- Users tab (admin only) ----- */
function loadUsers() {
    if (!session || session.role !== "Admin") return;
    var tbody = document.getElementById("users-tbody");
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Loading…</td></tr>';

    apiGet({ action: "listUsers", token: session.token }).then(function (res) {
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="3" class="status error">' + escapeHtml(res.error || "Could not load users") + "</td></tr>";
            return;
        }
        if (res.users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="muted">No users yet</td></tr>';
            return;
        }
        tbody.innerHTML = res.users.map(function (u) {
            return "<tr><td>" + escapeHtml(u.username) + "</td><td>" + escapeHtml(u.role) +
                "</td><td>" + escapeHtml(formatDate(u.createdAt)) + "</td></tr>";
        }).join("");
    }).catch(function () {
        tbody.innerHTML = '<tr><td colspan="3" class="status error">Network error</td></tr>';
    });
}

function onAddUserSubmit(e) {
    e.preventDefault();
    var statusEl = document.getElementById("add-user-status");
    var body = {
        action: "createUser",
        token: session.token,
        newUsername: document.getElementById("nu-username").value.trim(),
        newPassword: document.getElementById("nu-password").value,
        role: document.getElementById("nu-role").value
    };

    setStatus(statusEl, "Creating…", "");
    apiPost(body).then(function (res) {
        if (res.ok) {
            setStatus(statusEl, "User created", "ok");
            document.getElementById("add-user-form").reset();
            loadUsers();
        } else {
            setStatus(statusEl, res.error || "Could not create user", "error");
        }
    }).catch(function () { setStatus(statusEl, "Network error — try again", "error"); });
}

/* ----- Utils ----- */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}
