package com.stayvista.svdash

import android.content.Context
import android.content.Intent
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets

class JsBridge(private val context: Context) {

    /**
     * Reloads the WebView -- wire this to a hidden button or long-press
     * gesture in the dashboard for a manual config/content refresh.
     */
    @android.webkit.JavascriptInterface
    fun reload() {
        Handler(Looper.getMainLooper()).post {
            val activity = context as? MainActivity
            val webView = activity?.findViewById<WebView>(R.id.webView)
            webView?.loadUrl("file:///android_asset/index.html")
        }
    }

    /**
     * Manually triggers an OTA update check -- wire this to a hidden button
     * or long-press gesture in the dashboard for on-demand updates.
     */
    @android.webkit.JavascriptInterface
    fun checkForUpdate() {
        UpdateManager.checkForUpdate(context)
    }

    /**
     * Returns the room number provisioned for this TV, or "" if not yet set.
     * The dashboard uses this to decide whether to show the setup prompt.
     */
    @android.webkit.JavascriptInterface
    fun getRoomNumber(): String {
        return context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(MainActivity.KEY_ROOM, "") ?: ""
    }

    /**
     * Persists the room number for this TV and immediately re-syncs this
     * room's guest data from the cloud. Called once per TV during setup.
     */
    @android.webkit.JavascriptInterface
    fun setRoomNumber(room: String) {
        val trimmed = room.trim()
        context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(MainActivity.KEY_ROOM, trimmed)
            .apply()

        Handler(Looper.getMainLooper()).post {
            (context as? MainActivity)?.syncRoomConfig()
        }
    }

    @android.webkit.JavascriptInterface
    fun getInstalledApps(): String {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN, null)
        intent.addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        val resolved = pm.queryIntentActivities(intent, 0)
        val arr = JSONArray()
        for (info in resolved) {
            val obj = JSONObject()
            obj.put("label", info.loadLabel(pm).toString())
            obj.put("packageName", info.activityInfo.packageName)
            arr.put(obj)
        }
        return arr.toString()
    }

    @android.webkit.JavascriptInterface
    fun getSystemInfo(): String {
        val obj = JSONObject()
        obj.put("model", android.os.Build.MODEL)
        obj.put("brand", android.os.Build.BRAND)
        obj.put("version", android.os.Build.VERSION.RELEASE)
        obj.put("sdk", android.os.Build.VERSION.SDK_INT)
        return obj.toString()
    }

    @android.webkit.JavascriptInterface
    fun launchApp(appKey: String) {
        val key = appKey.lowercase()
        AppLauncher.launch(context, key)
    }

    @android.webkit.JavascriptInterface
    fun launchPackage(packageName: String) {
        val intent = context.packageManager.getLaunchIntentForPackage(packageName)
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }

    @android.webkit.JavascriptInterface
    fun openPlayStore() {
        val intent = context.packageManager.getLaunchIntentForPackage("com.android.vending")
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }

    @android.webkit.JavascriptInterface
    fun openSettings() {
        try {
            val intent = context.packageManager.getLaunchIntentForPackage("com.android.tv.settings")
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            } else {
                // Fallback to standard settings intent if TV settings package not found
                val settingsIntent = Intent(android.provider.Settings.ACTION_SETTINGS)
                settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(settingsIntent)
            }
        } catch (e: Exception) {
            Log.e("SVDash", "Could not open settings: ${e.message}")
        }
    }

    @android.webkit.JavascriptInterface
    fun playSound(soundType: String) {
        val file = if (soundType == "move") "sounds/move_click.mp3" else "sounds/selection_click.mp3"
        try {
            val afd = context.assets.openFd(file)
            val player = MediaPlayer()
            player.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            afd.close()
            player.prepare()
            player.start()
            player.setOnCompletionListener { it.release() }
        } catch (e: Exception) {
            Log.e("SVDash", "Error playing sound $file: ${e.message}")
        }
    }

    /**
     * Requests a graceful shutdown. Note: ACTION_REQUEST_SHUTDOWN is a
     * system-protected action -- it will only actually power off the
     * device if this app is system/platform-signed or a device-owner app.
     * On a normal sideloaded install this silently falls through to Settings.
     */
    @android.webkit.JavascriptInterface
    fun powerOff() {
        try {
            val intent = Intent("android.intent.action.ACTION_REQUEST_SHUTDOWN")
            intent.putExtra("android.intent.extra.KEY_CONFIRM", true)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (e: Exception) {
            openSettings()
        }
    }

    @android.webkit.JavascriptInterface
    fun readAsset(filename: String): String {
        // Try remote config first
        if (filename == "config.json") {
            val remote = RemoteConfigManager.getConfig(context)
            if (remote != null) return remote
        }

        return try {
            context.assets.open(filename).use { stream ->
                BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { it.readText() }
            }
        } catch (e: Exception) {
            Log.e("SVDash", "readAsset failed for $filename: ${e.message}")
            "{}"
        }
    }
}
