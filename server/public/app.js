"use strict";

// The session lives in sessionStorage, not localStorage: a shared front-desk
// machine shouldn't stay signed in after the browser closes.
const SESSION_KEY = "front-desk-session";
let session = null; // { token, username, role }
try {
  session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
} catch {
  session = null;
}

const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  // A FormData body (the ID scan upload) needs the browser to set its own
  // multipart Content-Type with the boundary — forcing application/json
  // here would break the upload.
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      "x-api-key": session?.token || "",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({ ok: false, error: "bad response" }));
  if (res.status === 401) {
    signOut();
    throw new Error("Session expired — sign in again");
  }
  if (!data.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function banner(message, kind = "") {
  const el = $("#banner");
  el.textContent = message;
  el.className = `banner ${kind}`;
  el.classList.remove("hidden");
  if (kind === "ok") setTimeout(() => el.classList.add("hidden"), 3000);
}

/* ---------- auth ---------- */

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  const err = $("#login-error");
  err.classList.add("hidden");
  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "bad response" }));
    if (!data.ok) throw new Error(data.error || "Invalid username or password");
    setSession({ token: data.token, username: data.username, role: data.role });
    showApp();
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove("hidden");
  }
});

function setSession(next) {
  session = next;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function signOut() {
  session = null;
  sessionStorage.removeItem(SESSION_KEY);
  $("#login-form").reset();
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
}

$("#signout").addEventListener("click", signOut);

function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#user-label").textContent = `${session.username} · ${session.role}`;
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", session.role !== "Admin"));
  refresh();
}

/* ---------- tabs ---------- */

const TABS = ["arrivals", "inhouse", "housekeeping", "update-tv", "users"];

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    TABS.forEach((id) => {
      $(`#${id}`).classList.toggle("hidden", id !== btn.dataset.tab);
    });
    if (btn.dataset.tab === "users") loadUsers();
  });
});

$("#sync-btn").addEventListener("click", async () => {
  const btn = $("#sync-btn");
  btn.disabled = true;
  try {
    const r = await api("/reservations/sync", { method: "POST" });
    banner(`Synced ${r.synced} booking(s)${r.skipped ? `, ${r.skipped} skipped` : ""}.`, "ok");
    await refresh();
  } catch (e) {
    banner(e.message, "bad");
  } finally {
    btn.disabled = false;
  }
});

/* ---------- rendering ---------- */

const fmt = (d) => (d ? String(d).slice(0, 10) : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function guestName(r) {
  const primary = r.guests.find((g) => g.role === "primary");
  if (!primary) return "No guest name";
  const { salutation, lastName } = primary.guest;
  return [salutation, lastName].filter(Boolean).join(" ");
}

function initials(r) {
  const primary = r.guests.find((g) => g.role === "primary");
  const words = primary?.guest.lastName.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

function reservationRow(r, mode) {
  const pax = r.pax ?? 0;
  const documented = r.documentedGuests;
  const ready = pax === 0 || documented >= pax;

  const paxPill = `<span class="pill ${ready ? "ok" : "warn"}">${documented}/${pax || "?"} documented</span>`;
  const roomPill = r.room
    ? `<span class="pill">Room ${esc(r.room.roomNumber)}</span>`
    : `<span class="pill warn">no room</span>`;
  // BD blanks the guest name on some cancelled bookings rather than always
  // marking Booking Status cancelled, so this is a heads-up for the front
  // desk to double-check, not a hard filter — /sync still imports the row.
  const cancelledPill = r.guests.some((g) => g.role === "primary")
    ? ""
    : `<span class="pill warn">possibly cancelled</span>`;

  const actions = [`<button data-act="view" data-id="${r.id}" class="secondary">View</button>`];
  if (mode === "arrivals") {
    actions.push(`<button data-act="room" data-id="${r.id}" class="secondary">${r.room ? "Change room" : "Assign room"}</button>`);
    actions.push(`<button data-act="guest" data-id="${r.id}" class="secondary">Add guest</button>`);
    actions.push(`<button data-act="checkin" data-id="${r.id}" ${r.room && ready ? "" : "disabled"}>Check in</button>`);
  } else {
    actions.push(`<button data-act="card" data-id="${r.id}" class="secondary">Issue card</button>`);
    actions.push(`<button data-act="checkout" data-id="${r.id}">Check out</button>`);
  }

  return `
    <div class="row">
      <div class="row-main">
        <div class="avatar">${esc(initials(r))}</div>
        <div>
          <div class="name">${esc(guestName(r))}</div>
          <div class="meta">${esc(r.externalPmsId)} · ${fmt(r.checkin)} → ${fmt(r.checkout)}${
            r.sourcePrimary ? ` · ${esc(r.sourcePrimary)}` : ""
          }</div>
        </div>
      </div>
      <div class="pills">${cancelledPill} ${roomPill} ${paxPill}</div>
      <div class="spacer"></div>
      <div class="actions">${actions.join("")}</div>
    </div>`;
}

// BD carries full booking history, not just upcoming stays — without a
// window, Arrivals would list years of past bookings alongside real ones.
// Covers a couple of days back (late/no-show follow-up) through a week
// ahead (what the front desk actually plans around).
function arrivalsWindow() {
  const from = new Date();
  from.setDate(from.getDate() - 2);
  const to = new Date();
  to.setDate(to.getDate() + 7);
  const iso = (d) => d.toISOString().slice(0, 10);
  return `checkinFrom=${iso(from)}&checkinTo=${iso(to)}`;
}

async function refresh() {
  try {
    const [confirmed, inhouse, rooms] = await Promise.all([
      api(`/reservations?status=confirmed&${arrivalsWindow()}`),
      api("/reservations?status=checked_in"),
      api("/rooms"),
    ]);

    $("#arrivals-list").innerHTML =
      confirmed.reservations.map((r) => reservationRow(r, "arrivals")).join("") ||
      `<p class="muted">No expected arrivals.</p>`;
    $("#inhouse-list").innerHTML =
      inhouse.reservations.map((r) => reservationRow(r, "inhouse")).join("") ||
      `<p class="muted">Nobody in house.</p>`;

    $("#rooms-legend").innerHTML = `
      <span class="l-ready">Ready</span>
      <span class="l-dirty">Dirty</span>
      <span class="l-occupied">Occupied</span>
      <span class="l-ooo">Out of service</span>`;
    $("#rooms-grid").innerHTML = rooms.rooms
      .map(
        (rm) => `
        <button class="room ${rm.status}" data-act="room-status" data-no="${esc(rm.roomNumber)}" data-status="${rm.status}">
          <div class="no">${esc(rm.roomNumber)}</div>
          <div class="cat">${esc(rm.category.replace("_", " "))}</div>
          <div class="cat">${esc(rm.status.replace("_", " "))}</div>
        </button>`,
      )
      .join("");
  } catch (e) {
    banner(e.message, "bad");
  }
}

/* ---------- actions ---------- */

function openModal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-content").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
}
$("#modal-close").addEventListener("click", closeModal);

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;

  try {
    if (btn.dataset.act === "view") {
      const [{ reservation }, { cards }] = await Promise.all([
        api(`/reservations/${id}`),
        api(`/reservations/${id}/cards`),
      ]);

      const guestBlock = (rg) => {
        const g = rg.guest;
        const docs = g.idDocuments
          .map(
            (d) => `
            <div class="row">
              <div>
                <div class="name">${esc(d.idType.replace("_", " "))} · ${esc(d.idNumber)}</div>
                <div class="meta">${[d.issuingCountry ? esc(d.issuingCountry) : "", d.scanRef ? "" : "no scan on file"].filter(Boolean).join(" · ")}</div>
              </div>
              <div class="spacer"></div>
              ${d.scanRef ? `<a href="${esc(d.scanRef)}" target="_blank" rel="noopener">View scan</a>` : ""}
            </div>`,
          )
          .join("") || `<p class="muted">No ID on file.</p>`;

        return `
          <div class="row">
            <div>
              <div class="name">${esc([g.salutation, g.lastName].filter(Boolean).join(" "))} <span class="pill">${esc(rg.role)}</span></div>
              <div class="meta">${esc(g.phone || "no phone")}${g.email ? ` · ${esc(g.email)}` : ""}</div>
            </div>
          </div>
          ${docs}`;
      };

      const cardBlock = cards.length
        ? cards
            .map(
              (c) => `
            <div class="row">
              <div>
                <div class="name">${esc([c.guest.salutation, c.guest.lastName].filter(Boolean).join(" "))}</div>
                <div class="meta">Issued ${fmt(c.issuedAt)} · expires ${fmt(c.expiresAt)}</div>
              </div>
              <div class="spacer"></div>
              <span class="pill ${c.status === "revoked" ? "bad" : "ok"}">${esc(c.status)}</span>
            </div>`,
            )
            .join("")
        : `<p class="muted">No cards issued.</p>`;

      openModal(
        esc(guestName(reservation)) || "Reservation",
        `<p class="meta">${esc(reservation.externalPmsId)} · ${fmt(reservation.checkin)} → ${fmt(reservation.checkout)}${
          reservation.room ? ` · Room ${esc(reservation.room.roomNumber)}` : ""
        }</p>
         <h3>Guests</h3>
         ${reservation.guests.map(guestBlock).join("")}
         <h3>Key cards</h3>
         ${cardBlock}`,
      );
    }

    if (btn.dataset.act === "checkin") {
      await api(`/reservations/${id}/check-in`, { method: "POST" });
      banner("Checked in — the room's TV now shows the guest.", "ok");
      await refresh();
    }

    if (btn.dataset.act === "checkout") {
      await api(`/reservations/${id}/check-out`, { method: "POST" });
      banner("Checked out — TV cleared, room marked dirty.", "ok");
      await refresh();
    }

    if (btn.dataset.act === "room") {
      const rooms = await api("/rooms?status=vacant_ready");
      const options = rooms.rooms
        .map((rm) => `<option value="${esc(rm.roomNumber)}">${esc(rm.roomNumber)} — ${esc(rm.category.replace("_", " "))}</option>`)
        .join("");
      openModal(
        "Assign room",
        options
          ? `<label>Ready rooms</label><select id="m-room">${options}</select>
             <div class="modal-actions"><button id="m-save">Assign</button></div>`
          : `<p class="muted">No ready rooms available.</p>`,
      );
      const save = $("#m-save");
      if (save)
        save.addEventListener("click", async () => {
          try {
            await api(`/reservations/${id}/room`, {
              method: "POST",
              body: JSON.stringify({ roomNumber: $("#m-room").value }),
            });
            closeModal();
            banner("Room assigned.", "ok");
            await refresh();
          } catch (err) {
            banner(err.message, "bad");
          }
        });
    }

    if (btn.dataset.act === "guest") {
      openModal(
        "Add guest details",
        `<label>Role</label>
         <select id="m-role"><option value="secondary">Additional pax</option><option value="primary">Primary guest</option></select>
         <label>Salutation</label><input id="m-sal" placeholder="Mr.">
         <label>Name</label><input id="m-name" placeholder="Full name" required>
         <label>Phone</label><input id="m-phone" placeholder="+91…" required>
         <label>ID type</label>
         <select id="m-idtype">
           <option value="aadhaar">Aadhaar</option>
           <option value="passport">Passport</option>
           <option value="drivers_license">Driver's licence</option>
           <option value="national_id">National ID</option>
           <option value="other">Other</option>
         </select>
         <label>ID number</label><input id="m-idno" required>
         <label>ID scan (optional)</label><input type="file" id="m-scan" accept="image/jpeg,image/png,image/webp,application/pdf">
         <div class="modal-actions"><button id="m-save">Save</button></div>`,
      );
      $("#m-save").addEventListener("click", async () => {
        try {
          const r = await api(`/reservations/${id}/guests`, {
            method: "POST",
            body: JSON.stringify({
              role: $("#m-role").value,
              salutation: $("#m-sal").value,
              lastName: $("#m-name").value,
              phone: $("#m-phone").value,
              idType: $("#m-idtype").value,
              idNumber: $("#m-idno").value,
            }),
          });

          // Uploaded as a second request, after the row it attaches to
          // exists — a failed Drive upload shouldn't undo guest details
          // that were otherwise fine.
          const file = $("#m-scan").files[0];
          if (file) {
            const form = new FormData();
            form.append("scan", file);
            await api(`/id-documents/${r.idDocument.id}/scan`, { method: "POST", body: form });
          }

          closeModal();
          banner("Guest details saved.", "ok");
          await refresh();
        } catch (err) {
          banner(err.message, "bad");
        }
      });
    }

    if (btn.dataset.act === "card") {
      const { reservation } = await api(`/reservations/${id}`);
      const options = reservation.guests
        .map((g) => `<option value="${g.guestId}">${esc([g.guest.salutation, g.guest.lastName].filter(Boolean).join(" "))} (${g.role})</option>`)
        .join("");
      openModal(
        "Issue key card",
        `<label>Guest</label><select id="m-guest">${options}</select>
         <div class="modal-actions"><button id="m-save">Issue</button></div>`,
      );
      $("#m-save").addEventListener("click", async () => {
        try {
          const r2 = await api(`/reservations/${id}/cards`, {
            method: "POST",
            body: JSON.stringify({ guestId: $("#m-guest").value }),
          });
          closeModal();
          if (r2.hardwareEncoded) {
            banner(`Card issued and encoded (${r2.card.id.slice(0, 8)}…).`, "ok");
          } else {
            banner(
              `Card recorded (${r2.card.id.slice(0, 8)}…) — encode it by hand, hardware bridge unavailable: ${r2.hardwareReason || "not configured"}.`,
              "warn",
            );
          }
        } catch (err) {
          banner(err.message, "bad");
        }
      });
    }

    if (btn.dataset.act === "room-status") {
      const no = btn.dataset.no;
      const status = btn.dataset.status;
      if (status === "occupied") {
        banner("Occupied rooms are released by checking the guest out.", "");
        return;
      }
      openModal(
        `Room ${no}`,
        `<label>Status</label>
         <select id="m-status">
           <option value="vacant_ready">Ready (cleaned)</option>
           <option value="vacant_dirty">Dirty</option>
           <option value="maintenance">Maintenance</option>
           <option value="out_of_order">Out of order</option>
         </select>
         <div class="modal-actions"><button id="m-save">Update</button></div>`,
      );
      $("#m-status").value = status;
      $("#m-save").addEventListener("click", async () => {
        try {
          const next = $("#m-status").value;
          // /ready is the dedicated housekeeping release; anything else is a
          // plain status change.
          if (next === "vacant_ready") {
            await api(`/rooms/${no}/ready`, { method: "POST" });
          } else {
            await api(`/rooms/${no}/status`, {
              method: "POST",
              body: JSON.stringify({ status: next }),
            });
          }
          closeModal();
          banner(`Room ${no} updated.`, "ok");
          await refresh();
        } catch (err) {
          banner(err.message, "bad");
        }
      });
    }
  } catch (err) {
    banner(err.message, "bad");
  }
});

/* ---------- update tv ---------- */

$("#update-tv-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const roomNo = $("#tv-room").value.trim();
  const statusEl = $("#tv-status");
  if (!roomNo) return;

  const data = {
    salutation: $("#tv-sal").value,
    lastName: $("#tv-name").value.trim(),
    checkin: $("#tv-checkin").value,
    checkout: $("#tv-checkout").value,
    message: $("#tv-message").value.trim(),
  };

  statusEl.textContent = "Checking room…";
  statusEl.className = "status span-2";
  try {
    const { room: existing } = await api(`/tv/${encodeURIComponent(roomNo)}`);
    if (existing && existing.lastName) {
      const name = [existing.salutation, existing.lastName].filter(Boolean).join(" ");
      openModal(
        "Room already occupied",
        `<p>Room ${esc(roomNo)} currently has ${esc(name)}${
          existing.checkout ? `, checking out ${esc(existing.checkout)}` : ""
        }. Pushing new details will overwrite this record.</p>
         <label class="checkbox-row"><input type="checkbox" id="m-confirm"> Yes, overwrite this room's guest details</label>
         <div class="modal-actions">
           <button type="button" id="m-cancel" class="secondary">Cancel</button>
           <button type="button" id="m-save" disabled>Confirm &amp; push</button>
         </div>`,
      );
      $("#m-confirm").addEventListener("change", (ev) => {
        $("#m-save").disabled = !ev.target.checked;
      });
      $("#m-cancel").addEventListener("click", closeModal);
      $("#m-save").addEventListener("click", async () => {
        closeModal();
        await pushToTv(roomNo, data, statusEl);
      });
      statusEl.textContent = "";
    } else {
      await pushToTv(roomNo, data, statusEl);
    }
  } catch (err) {
    statusEl.textContent = "Could not check room — try again";
    statusEl.className = "status span-2 error";
  }
});

async function pushToTv(roomNo, data, statusEl) {
  statusEl.textContent = "Pushing…";
  statusEl.className = "status span-2";
  $("#tv-push-btn").disabled = true;
  try {
    await api(`/tv/${encodeURIComponent(roomNo)}`, { method: "POST", body: JSON.stringify(data) });
    statusEl.textContent = `Room ${roomNo} saved — TV refreshes within a minute`;
    statusEl.className = "status span-2 ok";
    $("#update-tv-form").reset();
  } catch (err) {
    statusEl.textContent = err.message || "Push failed";
    statusEl.className = "status span-2 error";
  } finally {
    $("#tv-push-btn").disabled = false;
  }
}

/* ---------- users ---------- */

async function loadUsers() {
  if (session?.role !== "Admin") return;
  const list = $("#users-list");
  list.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const { users } = await api("/auth/users");
    list.innerHTML = users.length
      ? users
          .map(
            (u) => `
        <div class="row">
          <div>
            <div class="name">${esc(u.username)} <span class="pill">${esc(u.role)}</span></div>
            <div class="meta">Added ${fmt(u.createdAt)}</div>
          </div>
        </div>`,
          )
          .join("")
      : `<p class="muted">No users yet.</p>`;
  } catch (err) {
    list.innerHTML = `<p class="status error">${esc(err.message)}</p>`;
  }
}

$("#add-user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = $("#nu-status");
  statusEl.textContent = "Creating…";
  statusEl.className = "status span-2";
  try {
    await api("/auth/users", {
      method: "POST",
      body: JSON.stringify({
        username: $("#nu-username").value.trim(),
        password: $("#nu-password").value,
        role: $("#nu-role").value,
      }),
    });
    statusEl.textContent = "User created";
    statusEl.className = "status span-2 ok";
    $("#add-user-form").reset();
    await loadUsers();
  } catch (err) {
    statusEl.textContent = err.message || "Could not create user";
    statusEl.className = "status span-2 error";
  }
});

/* ---------- boot ---------- */

if (session) {
  fetch("/auth/verify", { headers: { "x-api-key": session.token } })
    .then((res) => (res.ok ? showApp() : signOut()))
    .catch(() => signOut());
}
