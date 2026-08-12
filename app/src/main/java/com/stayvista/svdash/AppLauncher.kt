package com.stayvista.svdash

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log

object AppLauncher {

    private data class AppEntry(val packageName: String, val fallbackUrl: String?)

    // Confirmed-working package/fallback set, recovered from the last APK
    // that installed and ran correctly on the Samsung/CVTE Android 4.4.4 TV.
    private val APP_MAP: Map<String, AppEntry> = mapOf(
        "netflix" to AppEntry("com.netflix.mediaclient", "https://www.netflix.com"),
        "youtube" to AppEntry("com.google.android.youtube.tv", "https://www.youtube.com/tv"),
        "prime" to AppEntry("com.amazon.amazonvideo.livingroom", "https://www.primevideo.com"),
        "jiohotstar" to AppEntry("in.startv.hotstar", "https://www.hotstar.com"),
        "zee5" to AppEntry("com.graymatrix.did", "https://www.zee5.com"),
        "sonyliv" to AppEntry("com.sonyliv", "https://www.sonyliv.com"),
        "ytmusic" to AppEntry("com.google.android.youtube.tv.music", "https://music.youtube.com/tv"),
        "livetv" to AppEntry("tv.cloudwalker.channels", null),
        "miracast" to AppEntry("com.google.android.apps.mediashell", null),
        "source" to AppEntry("com.android.tv.settings", null) // Generic fallback for source
    )

    fun launch(context: Context, appKey: String) {
        val key = appKey.lowercase()
        val entry = APP_MAP[key]
        if (entry == null) {
            Log.w("SVDash", "Unknown appKey: $appKey")
            return
        }

        val pm = context.packageManager
        
        // Handle Source button
        if (key == "source") {
            try {
                // Try multiple common TV Input/Source intents
                val sourceIntents = listOf(
                    Intent("com.android.tv.action.VIEW_INPUTS"),
                    Intent("com.android.tv.action.VIEW_SOURCE"),
                    Intent("android.intent.action.VIEW", Uri.parse("content://android.media.tv/passthrough")),
                    Intent("android.intent.action.MAIN").apply { 
                        setClassName("com.android.tv", "com.android.tv.MainActivity")
                    },
                    Intent("com.mediatek.tv.ui.intent.action.SOURCE_LIST"), // Common for MTK boards
                    Intent("com.cvte.tv.intent.action.SOURCE_LIST") // Common for CVTE boards
                )

                for (intent in sourceIntents) {
                    if (pm.resolveActivity(intent, 0) != null) {
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        context.startActivity(intent)
                        return
                    }
                }
                
                // Fallback to Cloudwalker/Generic TV app if installed
                val tvAppPackages = listOf("tv.cloudwalker.channels", "com.android.tv", "com.google.android.tv")
                for (pkg in tvAppPackages) {
                    val intent = pm.getLaunchIntentForPackage(pkg)
                    if (intent != null) {
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        context.startActivity(intent)
                        return
                    }
                }
            } catch (e: Exception) {
                Log.e("SVDash", "Source redirection failed: ${e.message}")
            }
        }

        // Handle Prime Video with deep package & activity search
        if (key == "prime") {
            val primePackages = listOf(
                "com.amazon.amazonvideo.livingroom",
                "com.amazon.avod.thirdpartyclient",
                "com.amazon.avod",
                "com.amazon.venezia"
            )
            for (pkg in primePackages) {
                // Try standard launch intent first
                var intent = pm.getLaunchIntentForPackage(pkg)
                
                // If standard fails, try searching specifically for Leanback activities (API 21+)
                if (intent == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    val leanbackIntent = Intent(Intent.ACTION_MAIN).apply {
                        addCategory("android.intent.category.LEANBACK_LAUNCHER")
                        setPackage(pkg)
                    }
                    val resolveInfo = pm.queryIntentActivities(leanbackIntent, 0)
                    if (resolveInfo.isNotEmpty()) {
                        intent = Intent(Intent.ACTION_MAIN).apply {
                            addCategory("android.intent.category.LEANBACK_LAUNCHER")
                            setClassName(pkg, resolveInfo[0].activityInfo.name)
                        }
                    }
                }

                if (intent != null) {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                    return
                }
            }
        }

        val launchIntent = pm.getLaunchIntentForPackage(entry.packageName)
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(launchIntent)
            return
        }

        // Special case: no dedicated Miracast app installed under the usual
        // package name -- scan installed launchable apps for a screencast-like match.
        if (key == "miracast") {
            try {
                val queryIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                val matches = pm.queryIntentActivities(queryIntent, 0)
                for (info in matches) {
                    val pkg = info.activityInfo.packageName.lowercase()
                    if (pkg.contains("miracast") || pkg.contains("wfd") || pkg.contains("screencast")) {
                        val intent = pm.getLaunchIntentForPackage(info.activityInfo.packageName)
                        if (intent != null) {
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            context.startActivity(intent)
                            return
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("SVDash", "Miracast scan failed: ${e.message}")
            }
        }

        val fallback = entry.fallbackUrl ?: "market://details?id=${entry.packageName}"
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(fallback))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e("SVDash", "Could not open fallback for $appKey: ${e.message}")
        }
    }
}
