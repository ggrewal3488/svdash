package com.stayvista.svdash

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object RemoteConfigManager {
    private const val TAG = "RemoteConfig"
    private const val CONFIG_FILENAME = "remote_config.json"
    private const val MAX_REDIRECTS = 5

    /** How often a running dashboard re-checks the cloud for a new guest push. */
    const val POLL_INTERVAL_MS = 60_000L

    // Google Apps Script URL - MAKE SURE THIS MATCHES YOUR LATEST DEPLOYMENT
    private const val BASE_URL = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec"

    /**
     * Fetches this room's guest data from the cloud.
     *
     * [onComplete] receives true only when the payload actually differs from
     * what's already cached. Callers use that to avoid reloading the WebView
     * on every poll -- an unconditional reload would flash the dashboard once
     * per [POLL_INTERVAL_MS] forever.
     */
    fun syncConfig(context: Context, roomNumber: String, onComplete: (changed: Boolean) -> Unit = {}) {
        Thread {
            var changed = false
            try {
                val scriptUrl = "$BASE_URL?room=$roomNumber&t=${System.currentTimeMillis()}"
                var connection = URL(scriptUrl).openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = false // We will follow manually
                connection.connectTimeout = 15000
                connection.readTimeout = 15000

                var responseCode = connection.responseCode

                // Manually follow all redirects (Google uses multiple)
                var hops = 0
                while (responseCode / 100 == 3 && hops++ < MAX_REDIRECTS) {
                    val newUrl = connection.getHeaderField("Location") ?: break
                    connection.disconnect()
                    connection = URL(newUrl).openConnection() as HttpURLConnection
                    connection.instanceFollowRedirects = false
                    connection.connectTimeout = 15000
                    connection.readTimeout = 15000
                    responseCode = connection.responseCode
                }

                if (responseCode == HttpURLConnection.HTTP_OK) {
                    val body = connection.inputStream.bufferedReader().use { it.readText() }
                    // Guard against Google serving an HTML error/login page.
                    if (body.trimStart().startsWith("{")) {
                        changed = saveConfig(context, body)
                        Log.d(TAG, "Synced Room $roomNumber (changed=$changed)")
                    } else {
                        Log.e(TAG, "Non-JSON response for Room $roomNumber; ignoring")
                    }
                } else {
                    Log.e(TAG, "Server returned error: $responseCode")
                }
                connection.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Network sync failed: ${e.message}")
            } finally {
                onComplete(changed)
            }
        }.start()
    }

    /** Writes the raw cloud payload. Returns true if it differs from the cached copy. */
    private fun saveConfig(context: Context, json: String): Boolean {
        return try {
            val file = File(context.filesDir, CONFIG_FILENAME)
            val previous = if (file.exists()) file.readText() else null
            if (previous == json) return false
            file.writeText(json)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error saving config: ${e.message}")
            false
        }
    }

    /**
     * The config the dashboard should render: the bundled assets/config.json
     * with the cloud payload layered on top.
     *
     * The Apps Script only sends the handful of keys it knows about (currently
     * just `property`). Returning it verbatim would silently drop wifi,
     * breakfast, apps and branding, so we merge rather than replace.
     */
    fun getConfig(context: Context): String? {
        val remote = readRemote(context) ?: return null

        // If the Apps Script returned a flat object (lastName at root), nest it
        // into a "guest" object so script.js can find it.
        val processedRemote = if (remote.has("lastName") && !remote.has("guest")) {
            val nested = JSONObject()
            val guest = JSONObject()
            val keys = remote.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                if (key == "roomNo") {
                    nested.put(key, remote.get(key))
                } else {
                    guest.put(key, remote.get(key))
                }
            }
            nested.put("guest", guest)
            nested
        } else {
            remote
        }

        val base = readAssetConfig(context) ?: return processedRemote.toString()
        return deepMerge(base, processedRemote).toString()
    }

    private fun readRemote(context: Context): JSONObject? {
        val file = File(context.filesDir, CONFIG_FILENAME)
        if (!file.exists()) return null
        return try {
            JSONObject(file.readText())
        } catch (e: Exception) {
            Log.e(TAG, "Cached remote config is not valid JSON: ${e.message}")
            null
        }
    }

    private fun readAssetConfig(context: Context): JSONObject? {
        return try {
            JSONObject(context.assets.open("config.json").bufferedReader().use { it.readText() })
        } catch (e: Exception) {
            Log.e(TAG, "Could not read bundled config.json: ${e.message}")
            null
        }
    }

    /**
     * Recursively overlays [overlay] onto [base]. Null and blank-string values
     * in the overlay are skipped so a partially-filled push can never wipe a
     * good local value.
     */
    private fun deepMerge(base: JSONObject, overlay: JSONObject): JSONObject {
        val out = JSONObject(base.toString())
        val keys = overlay.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val incoming = overlay.opt(key)
            val existing = out.opt(key)

            when {
                incoming == null || incoming === JSONObject.NULL -> Unit
                incoming is String && incoming.isBlank() -> Unit
                incoming is JSONObject && existing is JSONObject ->
                    out.put(key, deepMerge(existing, incoming))
                else -> out.put(key, incoming)
            }
        }
        return out
    }
}
