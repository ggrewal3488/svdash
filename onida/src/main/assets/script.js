/* ==========================================================
   STAYVISTA TV DASHBOARD
   script.js - Final Home Launcher Version (Navigation Fix)
========================================================== */

var CFG = {};
var APPS = [];
var currentFocus = 0;

var ICONS = {
    netflix: "icons/netflix.png",
    prime: "icons/prime.png",
    jiohotstar: "icons/jiostar.png",
    zee5: "icons/zee5.png",
    sonyliv: "icons/sonyliv.png",
    youtube: "icons/youtube.png",
    ytmusic: "icons/music.png",
    livetv: "icons/livetv.png",
    miracast: "icons/screencast.png",
    source: "icons/source.png",
    settings: "icons/settings.png"
};

function init() {
    startClock();
    renderApps();
    checkRoomSetup();
    renderDeviceInfo();
    initPromoCarousel();

    loadConfig(function(config) {
        CFG = config || {};
        renderWelcome();
        renderWifi();
        renderApps();

        // Fetch weather unless explicitly disabled. Remote config (from the
        // Master app) may omit the weather block entirely, so don't gate on
        // CFG.weather existing — fetchWeather() falls back to default coords.
        if (!CFG.weather || CFG.weather.enabled !== false) {
            fetchWeather();
            setInterval(fetchWeather, 900000);
        }
    });
}

/* ----- One-time per-TV room provisioning ----- */
function checkRoomSetup() {
    if (!(window.Android && typeof window.Android.getRoomNumber === 'function')) return;
    var room = "";
    try { room = window.Android.getRoomNumber(); } catch (e) {}
    if (!room) showRoomSetup();
}

function renderDeviceInfo() {
    var el = document.getElementById("device-info");
    if (!el || !window.Android) return;

    var room = "";
    var ip = "";

    try {
        if (typeof window.Android.getRoomNumber === 'function') {
            room = window.Android.getRoomNumber();
        }
        if (typeof window.Android.getIpAddress === 'function') {
            ip = window.Android.getIpAddress();
        }
    } catch (e) {}

    if (room || ip) {
        var text = "";
        if (room) text += "R" + room;
        if (room && ip) text += "  |  ";
        if (ip) text += ip;
        el.textContent = text;
    } else {
        // Retry once after 2 seconds if both are empty (bridge/network might be slow)
        setTimeout(renderDeviceInfo, 2000);
    }
}

/* ----- Center card promo carousel -----
 * Logo slide is always the first slide (already in index.html, class
 * "active"). Any promos pushed from Master are appended after it and the
 * whole set loops: logo -> promo 1 -> ... -> promo N -> logo -> ...
 * No promos synced yet (or bridge unavailable) -> no interval starts, card
 * just stays on the logo slide exactly like before this feature existed.
 */
var PROMO_SLIDE_MS = 8000;

function initPromoCarousel() {
    if (!(window.Android && typeof window.Android.getPromos === 'function')) return;

    var promos;
    try {
        promos = JSON.parse(window.Android.getPromos() || "[]");
    } catch (e) {
        promos = [];
    }
    if (!promos.length) return;

    var container = document.getElementById("promo-dynamic-slides");
    if (!container) return;

    container.innerHTML = "";
    promos.forEach(function (promo) {
        var slide = document.createElement("div");
        slide.className = "promo-slide";
        slide.dataset.promoId = promo.id;

        var img = document.createElement("img");
        img.className = "promo-image";
        img.src = promo.path;
        img.alt = "Promotion";

        slide.appendChild(img);
        container.appendChild(slide);
    });

    var slides = document.querySelectorAll("#promo-carousel .promo-slide");
    if (slides.length < 2) return; // just the logo -- nothing to rotate to

    var current = 0;
    setInterval(function () {
        var next = (current + 1) % slides.length;
        slides[current].classList.remove("active");
        slides[next].classList.add("active");
        current = next;
    }, PROMO_SLIDE_MS);
}

function showRoomSetup() {
    var overlay = document.getElementById("room-setup");
    var input = document.getElementById("room-input");
    var save = document.getElementById("room-save");
    if (!overlay || !input || !save) return;

    overlay.classList.remove("hidden");
    setTimeout(function() { input.focus(); }, 100);

    save.onclick = saveRoom;
    input.addEventListener("keydown", function(e) {
        if (e.keyCode === 13 || e.key === "Enter") { e.preventDefault(); saveRoom(); }
    });
}

function saveRoom() {
    var input = document.getElementById("room-input");
    if (!input) return;
    var val = input.value.trim();
    if (!val) { input.focus(); return; }

    playSound("select");
    if (window.Android && typeof window.Android.setRoomNumber === 'function') {
        // Persists the room and triggers a cloud sync + WebView reload natively.
        window.Android.setRoomNumber(val);
    }
    var overlay = document.getElementById("room-setup");
    if (overlay) overlay.classList.add("hidden");
}

function loadConfig(callback) {
    try {
        if (window.Android && typeof window.Android.readAsset === 'function') {
            var data = window.Android.readAsset("config.json");
            if (data && data !== "{}") {
                callback(JSON.parse(data));
                return;
            }
        }
    } catch (e) {}

    var xhr = new XMLHttpRequest();
    xhr.open("GET", "config.json", true);
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4 && xhr.status === 200) {
            try { callback(JSON.parse(xhr.responseText)); } catch(e) { callback({}); }
        }
    };
    xhr.send();
}

function renderWelcome() {
    var p = CFG.property || {};
    var g = CFG.guest || {};
    var name = document.getElementById("welcome-name");
    var tagline = document.getElementById("welcome-tagline");
    var guestLine = document.getElementById("welcome-guest");

    // The brand name/tagline always stay on screen -- they come from
    // config.json only and are never overwritten by a guest push.
    if (name) name.textContent = p.name || "StayVista Residences";
    if (tagline) tagline.textContent = p.tagline || "Unlock Comfort. Every Time!";

    // Guest details are pushed from the Master app. Preferred shape is a
    // structured CFG.guest object; older Apps Script deployments only return
    // property.tagline as one free-text line, so parse that as a fallback.
    var legacy = parseLegacyGuestLine(p.tagline);

    var guestName = joinGuestName(g.salutation, g.lastName) ||
                    p.guestName || p.guestWelcome ||
                    legacy.name;

    var message = g.message || legacy.message || "";

    if (guestLine) {
        if (guestName) {
            guestLine.textContent = "Welcome, " + guestName + (message ? " — " + message : "");
            guestLine.classList.remove("hidden");
        } else {
            guestLine.textContent = "";
            guestLine.classList.add("hidden");
        }
    }
}

function joinGuestName(salutation, lastName) {
    if (!lastName) return "";
    return ((salutation || "") + " " + lastName).replace(/\s+/g, " ").trim();
}

/*
 * Unpacks the single line the current Apps Script deployment returns, e.g.
 *   "Guest Room No. 101 Mr. Sharma - Enjoy your stay"
 * into { name: "Mr. Sharma", message: "Enjoy your stay" }.
 * Anything that isn't in that shape (including the default brand tagline)
 * yields empty strings so the caller falls back cleanly.
 */
function parseLegacyGuestLine(line) {
    var empty = { name: "", message: "" };
    if (!line || typeof line !== "string") return empty;

    // The separator must be a spaced hyphen so hyphenated surnames survive.
    var m = line.match(/^\s*Guest Room No\.\s*\S+\s+(.*?)(?:\s+-\s*(.*))?$/);
    if (!m) return empty;

    return { name: (m[1] || "").trim(), message: (m[2] || "").trim() };
}

function renderWifi() {
    var w = CFG.wifi || {};
    var net = document.getElementById("wifi-network");
    var pass = document.getElementById("wifi-password");
    if (net) net.textContent = w.network || "StayVista Residences";
    if (pass) pass.textContent = w.password || "liveathome@dlf3";
}

function renderApps() {
    var row = document.getElementById("app-row");
    if (!row) return;

    // Default set, used until config.json loads (or if it omits "apps").
    var DEFAULT_APPS = [
        { key: "netflix",    label: "Netflix" },
        { key: "prime",      label: "Prime Video" },
        { key: "jiohotstar", label: "JioHotstar" },
        { key: "zee5",       label: "ZEE5" },
        { key: "sonyliv",    label: "SonyLIV" },
        { key: "youtube",    label: "YouTube" },
        { key: "ytmusic",    label: "YT Music" },
        { key: "livetv",     label: "Live TV" },
        { key: "miracast",   label: "Cast" },
        { key: "source",     label: "Source" },
        { key: "settings",   label: "Settings" }
    ];

    APPS = (CFG.apps && CFG.apps.length) ? CFG.apps : DEFAULT_APPS;

    row.innerHTML = "";
    for (var i = 0; i < APPS.length; i++) {
        (function(index) {
            var app = APPS[index];
            var btn = document.createElement("button");
            btn.className = "app-btn";
            if (index === 0) btn.classList.add("active-btn");

            var iconPath = ICONS[app.key] || "icons/info.png";
            btn.innerHTML = '<img class="app-icon-img" src="' + iconPath + '" alt="' + app.label + '">' +
                            '<span>' + app.label + '</span>';

            btn.onclick = function() { launchApp(app.key); };

            // Sync currentFocus with browser focus
            btn.onfocus = function() { setActive(index); };

            row.appendChild(btn);
        })(i);
    }
}

function setActive(index) {
    if (currentFocus !== index) {
        playSound("move");
    }
    currentFocus = index;
    var btns = document.querySelectorAll(".app-btn");
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle("active-btn", i === index);
    }
}

function playSound(type) {
    if (window.Android && typeof window.Android.playSound === 'function') {
        window.Android.playSound(type);
    }
}

function launchApp(key) {
    playSound("select");
    if (key === "settings") {
        openSettings();
        return;
    }
    if (window.Android && typeof window.Android.launchApp === 'function') {
        window.Android.launchApp(key);
    }
}

function openSettings() {
    playSound("select");
    if (window.Android && typeof window.Android.openSettings === 'function') {
        window.Android.openSettings();
    }
}

function powerOff() {
    playSound("select");
    if (window.Android && typeof window.Android.powerOff === 'function') {
        window.Android.powerOff();
    }
}

function startClock() {
    var timeEl = document.getElementById("clock-time");
    var dateEl = document.getElementById("clock-date");
    var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    function update() {
        var now = new Date();
        var hour = now.getHours();
        var min = now.getMinutes();
        if (min < 10) min = "0" + min;
        var ampm = hour >= 12 ? "PM" : "AM";
        hour = hour % 12 || 12;

        if (timeEl) timeEl.innerHTML = hour + ":" + min + ' <span class="ampm">' + ampm + '</span>';
        if (dateEl) dateEl.textContent = days[now.getDay()] + ", " + now.getDate() + " " + months[now.getMonth()] + " " + now.getFullYear();
    }
    update();
    setInterval(update, 1000);
}

function fetchWeather() {
    var lat = (CFG.weather && CFG.weather.latitude) || 28.6139;
    var lon = (CFG.weather && CFG.weather.longitude) || 77.2090;

    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon + "&current_weather=true";

    function makeRequest(targetUrl) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", targetUrl, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        var j = JSON.parse(xhr.responseText);
                        var c = j.current_weather;
                        var isDay = c.is_day !== 0;

                        // WMO Weather interpretation codes
                        // https://open-meteo.com/en/docs
                        var codes = {
                            0:"Clear Sky", 1:"Mainly Clear", 2:"Partly Cloudy", 3:"Overcast",
                            45:"Foggy", 48:"Foggy",
                            51:"Drizzle", 53:"Drizzle", 55:"Drizzle",
                            61:"Rainy", 63:"Rainy", 65:"Rainy",
                            71:"Snowy", 73:"Snowy", 75:"Snowy",
                            80:"Showers", 81:"Showers", 82:"Showers",
                            95:"Thunderstorm"
                        };

                        var icons = {
                            // Clear
                            0: isDay ? "☀️" : "🌙",
                            // Mainly clear / Partly cloudy
                            1: isDay ? "🌤️" : "☁️🌙",
                            2: isDay ? "⛅" : "☁️🌙",
                            // Overcast
                            3: "☁️",
                            // Fog
                            45: "🌫️", 48: "🌫️",
                            // Drizzle/Rain/Showers
                            51: "🌦️", 53: "🌦️", 55: "🌦️",
                            61: "🌧️", 63: "🌧️", 65: "🌧️",
                            80: "🌧️", 81: "🌧️", 82: "🌧️",
                            // Thunder
                            95: "⛈️"
                        };

                        // Fallback logic for requested states if codes missing above
                        var icon = icons[c.weathercode] || "⛅";
                        var desc = codes[c.weathercode] || "Partly Cloudy";

                        // User specific overrides
                        if (c.weathercode >= 1 && c.weathercode <= 2) {
                            icon = isDay ? "🌤️" : "☁️🌙"; // Cloud with sun / Moon with cloud
                        } else if (c.weathercode === 0) {
                            icon = isDay ? "☀️" : "🌙"; // Sun / Moon
                        } else if ((c.weathercode >= 51 && c.weathercode <= 67) || (c.weathercode >= 80 && c.weathercode <= 82)) {
                            icon = "🌧️"; // Cloud with rain
                        }

                        var iconEl = document.getElementById("weather-icon");
                        var tempEl = document.getElementById("weather-temp");
                        var descEl = document.getElementById("weather-desc");

                        if (iconEl) iconEl.textContent = icon;
                        if (tempEl) tempEl.textContent = Math.round(c.temperature) + "°C";
                        if (descEl) descEl.textContent = desc;
                    } catch (e) {}
                } else if (targetUrl.indexOf("https") === 0) {
                    makeRequest(targetUrl.replace("https", "http"));
                }
            }
        };
        xhr.send();
    }
    makeRequest(url);
}

document.addEventListener("keydown", function(e) {
    var selectable = document.querySelectorAll(".app-btn");
    if (!selectable.length) return;

    // Handle Back button
    if (e.keyCode === 27 || e.key === "Escape" || e.keyCode === 4 || e.key === "BrowserBack") {
        if (window.location.href.indexOf("android_asset/index.html") === -1) {
            window.location.href = "index.html";
            return;
        }
    }

    if (e.keyCode === 13 || e.key === "Enter") {
        var active = document.activeElement;
        if (active && active.classList.contains("app-btn")) {
            active.click();
        }
    }
});

init();
