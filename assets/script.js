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
    youtube: "icons/youtube.png",
    ytmusic: "icons/music.png",
    livetv: "icons/livetv.png",
    miracast: "icons/screencast.png",
    playstore: "icons/playstore.png"
};

function init() {
    startClock();
    renderApps();

    loadConfig(function(config) {
        CFG = config || {};
        renderWelcome();
        renderWifi();
        renderApps();

        if (CFG.weather && CFG.weather.enabled !== false) {
            fetchWeather();
            setInterval(fetchWeather, 900000);
        }
    });
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
    var name = document.getElementById("welcome-name");
    var tagline = document.getElementById("welcome-tagline");
    if (name) name.textContent = p.name || "StayVista Residences";
    if (tagline) tagline.textContent = p.tagline || "Unlock Comfort, Every time!";
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

    APPS = [
        { key: "netflix",    label: "Netflix" },
        { key: "prime",      label: "Prime Video" },
        { key: "jiohotstar", label: "Hotstar" },
        { key: "youtube",    label: "YouTube" },
        { key: "ytmusic",    label: "YT Music" },
        { key: "livetv",     label: "Live TV" },
        { key: "miracast",   label: "Cast" },
        { key: "playstore",  label: "Play Store" }
    ];

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
                        var codes = { 0:"Clear Sky", 1:"Partly Cloudy", 2:"Partly Cloudy", 3:"Cloudy" };
                        var icons = { 0:"☀️", 1:"🌤️", 2:"⛅", 3:"☁️" };

                        var iconEl = document.getElementById("weather-icon");
                        var tempEl = document.getElementById("weather-temp");
                        var descEl = document.getElementById("weather-desc");

                        if (iconEl) iconEl.textContent = icons[c.weathercode] || "⛅";
                        if (tempEl) tempEl.textContent = Math.round(c.temperature) + "°C";
                        if (descEl) descEl.textContent = codes[c.weathercode] || "Partly Cloudy";
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
    var btns = document.querySelectorAll(".app-btn");
    if (!btns.length) return;

    // Handle Back button
    if (e.keyCode === 27 || e.key === "Escape" || e.keyCode === 4 || e.key === "BrowserBack") {
        if (window.location.href.indexOf("android_asset/index.html") === -1) {
            window.location.href = "index.html";
            return;
        }
    }

    // Note: We removed the manual ArrowRight/ArrowLeft focus calls
    // to let the browser's native spatial navigation handle it.
    // This prevents the "skipping" issue you experienced.

    if (e.keyCode === 13 || e.key === "Enter") {
        // If an icon is focused, click it
        var active = document.activeElement;
        if (active && active.classList.contains("app-btn")) {
            active.click();
        }
    }
});

init();
