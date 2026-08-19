package com.stayvista.svdash

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection

/**
 * Syncs the center card's promotional images from the Master backend.
 *
 * Mirrors [RemoteConfigManager]'s cache-and-diff shape: a lightweight metadata
 * poll (id/hash/order) decides what actually needs downloading, so a running
 * TV isn't re-fetching all 5 images every [RemoteConfigManager.POLL_INTERVAL_MS].
 */
object PromoManager {
    private const val TAG = "PromoManager"
    private const val META_FILENAME = "promos_meta.json"
    private const val PROMOS_DIR = "promos"

    /**
     * [onComplete] receives true only when the promo set actually changed
     * (added/updated/removed), same "don't flash the dashboard" contract as
     * [RemoteConfigManager.syncConfig].
     */
    fun syncPromos(context: Context, onComplete: (changed: Boolean) -> Unit = {}) {
        Thread {
            var changed = false
            try {
                val url = "${RemoteConfigManager.BASE_URL}?action=getPromos&t=${System.currentTimeMillis()}"
                val connection = HttpUtil.openFollowingRedirects(url)
                val responseCode = connection.responseCode

                if (responseCode == HttpURLConnection.HTTP_OK) {
                    val body = connection.inputStream.bufferedReader().use { it.readText() }
                    if (body.trimStart().startsWith("{")) {
                        changed = applyPromos(context, body)
                    } else {
                        Log.e(TAG, "Non-JSON response for getPromos; ignoring")
                    }
                } else {
                    Log.e(TAG, "Server returned error: $responseCode")
                }
                connection.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Promo sync failed: ${e.message}")
            } finally {
                onComplete(changed)
            }
        }.start()
    }

    /** Returns cached promos as a JSON array of {id, path}, ordered, for the JS bridge. */
    fun getCachedPromosJson(context: Context): String {
        val meta = readMeta(context) ?: return "[]"
        val promos = meta.optJSONArray("promos") ?: return "[]"
        val promosDir = File(context.filesDir, PROMOS_DIR)
        val out = JSONArray()
        for (i in 0 until promos.length()) {
            val p = promos.getJSONObject(i)
            val file = File(promosDir, p.getString("id") + p.getString("ext"))
            if (!file.exists()) continue
            out.put(JSONObject().apply {
                put("id", p.getString("id"))
                put("path", "file://${file.absolutePath}")
            })
        }
        return out.toString()
    }

    private fun applyPromos(context: Context, body: String): Boolean {
        val response = JSONObject(body)
        val remotePromos = response.optJSONArray("promos") ?: JSONArray()
        val promosDir = File(context.filesDir, PROMOS_DIR)
        if (!promosDir.exists()) promosDir.mkdirs()

        val cachedMeta = readMeta(context)
        val cachedById = mutableMapOf<String, JSONObject>()
        cachedMeta?.optJSONArray("promos")?.let { arr ->
            for (i in 0 until arr.length()) {
                val p = arr.getJSONObject(i)
                cachedById[p.getString("id")] = p
            }
        }

        var changed = false
        val newMetaPromos = JSONArray()
        val keepIds = mutableSetOf<String>()

        for (i in 0 until remotePromos.length()) {
            val promo = remotePromos.getJSONObject(i)
            val id = promo.getString("id")
            val url = promo.getString("url")
            val hash = promo.optString("hash", "")
            val order = promo.optInt("order", i)
            keepIds.add(id)

            val cached = cachedById[id]
            val ext = extFromUrl(url)
            val file = File(promosDir, "$id$ext")

            if (cached == null || cached.optString("hash") != hash || !file.exists()) {
                if (downloadImage(url, file)) {
                    changed = true
                } else {
                    Log.e(TAG, "Failed to download promo $id; keeping previous copy if any")
                }
            }

            newMetaPromos.put(JSONObject().apply {
                put("id", id)
                put("hash", hash)
                put("order", order)
                put("ext", ext)
            })
        }

        // Drop cached files/entries for promos no longer active.
        cachedById.keys.filter { it !in keepIds }.forEach { staleId ->
            val ext = cachedById[staleId]?.optString("ext", "") ?: ""
            File(promosDir, "$staleId$ext").delete()
            changed = true
        }

        if (changed || cachedMeta == null) {
            val newMeta = JSONObject().put("promos", newMetaPromos)
            File(context.filesDir, META_FILENAME).writeText(newMeta.toString())
        }

        return changed
    }

    private fun downloadImage(url: String, dest: File): Boolean {
        return try {
            val connection = HttpUtil.openFollowingRedirects(url)
            val ok = connection.responseCode == HttpURLConnection.HTTP_OK
            if (ok) {
                connection.inputStream.use { input ->
                    dest.outputStream().use { output -> input.copyTo(output) }
                }
            }
            connection.disconnect()
            ok
        } catch (e: Exception) {
            Log.e(TAG, "Error downloading $url: ${e.message}")
            false
        }
    }

    private fun extFromUrl(url: String): String {
        // Drive's direct-view URLs carry no file extension, so this is really
        // just a stable, filesystem-safe suffix -- the WebView doesn't care
        // about it, image bytes are served/read as-is regardless of name.
        return ".img"
    }

    private fun readMeta(context: Context): JSONObject? {
        val file = File(context.filesDir, META_FILENAME)
        if (!file.exists()) return null
        return try {
            JSONObject(file.readText())
        } catch (e: Exception) {
            null
        }
    }
}
