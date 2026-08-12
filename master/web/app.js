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
    apiGet({ room: roomNo }).then(function (existing) {
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

    apiGet({ room: "ALL" }).then(function (rooms) {
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
