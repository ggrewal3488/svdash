package com.stayvista.onida

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * UpdateManager — lightweight OTA updater for sideloaded TVs with no ADB.
 *
 * Flow:
 *   1. Ask GitHub for this repo's Releases and find the newest one tagged
 *      "onida-v<versionCode>" -- svdash's own app/ module has its own
 *      UpdateManager pointed at plain "v*" tags via GET /releases/latest,
 *      but every onida-v* release is published as a pre-release (see
 *      .github/workflows/onida.yml) specifically so it never becomes the
 *      repo's overall "latest" release and confuses that updater. That
 *      means this app can't use /releases/latest either -- it has to list
 *      releases and filter by tag prefix itself.
 *   2. Compare that tag's version to the installed versionCode
 *   3. If newer, download the .apk release asset via DownloadManager
 *   4. Fire the system install intent (FileProvider-backed) once downloaded
 *
 * The TV still has to see one tap on the native "Install this app?" dialog —
 * this app is not system/platform-signed, so a fully silent install isn't
 * possible without rooting the device or using a device-owner/MDM setup.
 * This removes the USB-drive step entirely, which is the main win.
 *
 * Requires the repo's Releases to be publicly downloadable — an
 * unauthenticated request can't pull assets from a private repo, and a
 * GitHub token has no safe way to live inside a shipped APK.
 */
object UpdateManager {

    private const val TAG = "OnidaUpdater"

    private const val GITHUB_OWNER = "ggrewal3488"
    private const val GITHUB_REPO = "svdash"
    private const val RELEASES_URL =
        "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/releases"

    private const val TAG_PREFIX = "onida-v"
    private const val APK_FILENAME = "onida-update.apk"

    /** How often to re-check while the dashboard stays running (see MainActivity). */
    const val CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L

    /**
     * Call from MainActivity.onCreate() (after a short delay so it doesn't
     * compete with initial WebView load), and periodically thereafter —
     * TVs that never reboot would otherwise never see an update.
     */
    fun checkForUpdate(context: Context) {
        Thread {
            try {
                val release = fetchLatestOnidaRelease()
                if (release == null) {
                    Log.w(TAG, "Release check failed or returned nothing")
                    return@Thread
                }

                val latestVersionCode = parseVersionCode(release.optString("tag_name"))
                val apkUrl = findApkAssetUrl(release)
                val currentVersionCode = getCurrentVersionCode(context)

                if (latestVersionCode == null || apkUrl == null) {
                    Log.w(TAG, "Latest release has no usable tag/apk asset")
                    return@Thread
                }

                Log.d(TAG, "Current version: $currentVersionCode, latest: $latestVersionCode")

                if (latestVersionCode > currentVersionCode) {
                    Log.d(TAG, "Newer version available — downloading")
                    downloadApk(context, apkUrl)
                } else {
                    Log.d(TAG, "Already up to date")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Update check failed: ${e.message}")
            }
        }.start()
    }

    /** Newest release (list is sorted newest-first) whose tag starts with "onida-v". */
    private fun fetchLatestOnidaRelease(): JSONObject? {
        return try {
            val conn = URL(RELEASES_URL).openConnection() as HttpURLConnection
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            conn.requestMethod = "GET"
            // GitHub's API rejects requests with no User-Agent.
            conn.setRequestProperty("User-Agent", "Onida-Updater")
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            val releases = org.json.JSONArray(body)
            for (i in 0 until releases.length()) {
                val release = releases.optJSONObject(i) ?: continue
                if (release.optString("tag_name").startsWith(TAG_PREFIX)) return release
            }
            null
        } catch (e: Exception) {
            Log.e(TAG, "fetchLatestOnidaRelease failed: ${e.message}")
            null
        }
    }

    /** "onida-v4" -> 4. Anything not matching the "onida-v<int>" tag convention yields null. */
    private fun parseVersionCode(tagName: String?): Int? {
        return tagName?.removePrefix(TAG_PREFIX)?.toIntOrNull()
    }

    private fun findApkAssetUrl(release: JSONObject): String? {
        val assets = release.optJSONArray("assets") ?: return null
        for (i in 0 until assets.length()) {
            val asset = assets.optJSONObject(i) ?: continue
            val name = asset.optString("name")
            if (name.endsWith(".apk", ignoreCase = true)) {
                return asset.optString("browser_download_url").takeIf { it.isNotBlank() }
            }
        }
        return null
    }

    private fun getCurrentVersionCode(context: Context): Int {
        val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pInfo.longVersionCode.toInt()
        } else {
            @Suppress("DEPRECATION")
            pInfo.versionCode
        }
    }

    private fun downloadApk(context: Context, apkUrl: String) {
        val destDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        val destFile = File(destDir, APK_FILENAME)
        if (destFile.exists()) destFile.delete()

        val request = apkUrl.toUri().let { uri ->
            DownloadManager.Request(uri).apply {
                setTitle("SVDash Onida Update")
                setDescription("Downloading latest dashboard version")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationUri(Uri.fromFile(destFile))
                setAllowedOverMetered(true)
                setAllowedOverRoaming(true)
            }
        }

        val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val downloadId = downloadManager.enqueue(request)

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                if (id == downloadId) {
                    context.unregisterReceiver(this)
                    promptInstall(context, destFile)
                }
            }
        }

        ContextCompat.registerReceiver(
            context,
            receiver,
            IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    private fun promptInstall(context: Context, apkFile: File) {
        // Android 8+ requires the user to explicitly allow this app to
        // install unknown apps, granted once per app in system settings.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.packageManager.canRequestPackageInstalls()) {
                Log.w(TAG, "Install permission not granted — sending user to settings")
                val settingsIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    "package:${context.packageName}".toUri(),
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(settingsIntent)
                return
            }
        }

        val apkUri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile)
        } else {
            @Suppress("DEPRECATION")
            Uri.fromFile(apkFile)
        }

        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        context.startActivity(installIntent)
    }
}
