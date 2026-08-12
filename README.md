# SVDash — StayVista Hotel TV Launcher

A kiosk-mode Android WebView launcher for hotel TV boxes, displaying a full-screen guest dashboard with live clock, weather, Wi-Fi credentials, breakfast info, streaming app shortcuts, and a guest-services QR card.

---

## 📐 Architecture

```
Android (Kotlin)
└── MainActivity.kt     Full-screen WebView, keep-screen-on, block back button
    └── JsBridge.kt     @JavascriptInterface → exposes launchApp(), readAsset()
    └── BootReceiver.kt Auto-launch on TV box power-on
    └── AppLauncher.kt  Maps app keys → package names, launches via Intent

WebView assets/
├── index.html          Dashboard layout
├── style.css           Dark luxury theme (--gold / --bg CSS variables)
├── script.js           Clock, weather (Open-Meteo), QR generation, app row
├── config.json         ← ONE FILE to edit per property
└── qrcode.min.js       QR code generator (offline-capable)
```

---

## ⚙️ Customise per property

Edit **`app/src/main/assets/config.json`** only:

```json
{
  "property": { "name": "Villa Bali", "tagline": "Your home in the hills." },
  "wifi":     { "network": "VillaBali_Guest", "password": "bali@2025" },
  "breakfast":{ "startTime": "8:00 AM", "endTime": "11:00 AM" },
  "guestQR":  { "url": "https://stayvista.com/guest/villa-bali" },
  "contacts": { "guestServices": "+91 98100 XXXXX", "whatsapp": "+91 98100 XXXXX" },
  "weather":  { "latitude": 28.5244, "longitude": 77.1855, "enabled": true }
}
```

> For multi-property deployments, maintain one `config.json` per property and build a separate APK variant per property (or push updated configs via ADB).

---

## 🚀 Build locally

**Prerequisites:** Android Studio or JDK 17 + Android SDK

```bash
git clone https://github.com/YOUR_ORG/svdash.git
cd svdash

# Debug build (no signing required)
./gradlew assembleDebug

# Install directly to a connected TV box / emulator
adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## 📦 Build via GitHub Actions

Every push to `main` or `develop` automatically builds a **debug APK**, available as a downloadable artifact in the Actions tab.

**To publish a release:**

1. Set up repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `KEYSTORE_BASE64` | `base64 -i your.jks` output |
| `STORE_PASSWORD` | Keystore password |
| `KEY_ALIAS` | Key alias |
| `KEY_PASSWORD` | Key password |

2. Push a version tag:
```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds a **signed release APK** and attaches it to a GitHub Release automatically.

---

## 📺 Deployment to TV boxes

### Via ADB (USB or network)
```bash
# USB
adb install -r app-release.apk

# Network (TV box must have ADB over network enabled)
adb connect 192.168.1.XXX:5555
adb install -r app-release.apk
```

### Set as default launcher
On first install, Android will ask which launcher to use. Choose **SVDash** and tap **Always**. Or push it silently via ADB:
```bash
adb shell cmd package set-home-activity com.stayvista.svdash/.MainActivity
```

---

## ➕ Adding a streaming app

**Step 1 — `AppLauncher.kt`**: add the package name
```kotlin
"zee5" to AppEntry("com.graymatrix.did", "https://www.zee5.com"),
```

**Step 2 — `script.js`**: add an icon in `appIcon()`
```js
zee5: `<svg ...>...</svg>`,
```

**Step 3 — `config.json`**: add to the apps array
```json
{ "key": "zee5", "label": "ZEE5", "icon": "zee5" }
```

---

## 🌤️ Weather

Uses [Open-Meteo](https://open-meteo.com/) — free, no API key, GDPR compliant. Coordinates are set in `config.json → weather.latitude/longitude`. Set `"enabled": false` to hide the widget.

---

## 📁 Project structure

```
svdash/
├── app/src/main/
│   ├── java/com/stayvista/svdash/
│   │   ├── MainActivity.kt
│   │   ├── JsBridge.kt
│   │   ├── BootReceiver.kt
│   │   └── AppLauncher.kt
│   ├── assets/
│   │   ├── index.html       ← dashboard layout
│   │   ├── style.css        ← theme
│   │   ├── script.js        ← runtime logic
│   │   ├── config.json      ← property config ← EDIT THIS
│   │   └── qrcode.min.js    ← offline QR library
│   ├── res/
│   │   ├── drawable/tv_banner.png
│   │   ├── mipmap-*/ic_launcher.png
│   │   └── values/{strings,themes}.xml
│   └── AndroidManifest.xml
├── .github/workflows/android.yml
├── build.gradle
├── settings.gradle
└── README.md
```

---

## 🔒 Kiosk behaviour

| Behaviour | Implementation |
|---|---|
| Back button disabled | `onBackPressed()` is a no-op |
| Screen always on | `FLAG_KEEP_SCREEN_ON` |
| Auto-start after reboot | `BootReceiver` + `BOOT_COMPLETED` |
| Full-screen immersive | `WindowInsetsController` / `SYSTEM_UI_FLAG_IMMERSIVE_STICKY` |
| Default launcher | `HOME` + `DEFAULT` intent categories in manifest |

---

## License

Internal tool — StayVista Hospitality Pvt. Ltd.
