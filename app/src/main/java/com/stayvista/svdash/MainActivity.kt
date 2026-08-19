package com.stayvista.svdash

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit

class MainActivity : AppCompatActivity() {

    companion object {
        const val PREFS_NAME = "svdash"
        const val KEY_ROOM = "room_number"
    }

    private lateinit var webView: WebView

    private val pollHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val pollRunnable = object : Runnable {
        override fun run() {
            syncRoomConfig()
            pollHandler.postDelayed(this, RemoteConfigManager.POLL_INTERVAL_MS)
        }
    }

    // A TV that was just switched on may take a few seconds to bring WiFi/
    // Ethernet up -- the first syncRoomConfig() in onResume() can fire before
    // that's ready and just fail. Rather than sit on that failure for a full
    // POLL_INTERVAL_MS, re-sync the moment connectivity actually shows up.
    private lateinit var connectivityManager: ConnectivityManager
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            runOnUiThread { syncRoomConfig() }
        }
    }

    // Boot-time launch already triggers one check (below); this catches TVs
    // that stay powered on for weeks without ever rebooting.
    private val updateCheckHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val updateCheckRunnable = object : Runnable {
        override fun run() {
            UpdateManager.checkForUpdate(this@MainActivity)
            updateCheckHandler.postDelayed(this, UpdateManager.CHECK_INTERVAL_MS)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        hideSystemUI()

        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        
        // Clear cache and cookies for development
        webView.clearCache(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            android.webkit.CookieManager.getInstance().removeAllCookies(null)
            android.webkit.CookieManager.getInstance().flush()
        } else {
            @Suppress("DEPRECATION")
            android.webkit.CookieManager.getInstance().removeAllCookie()
        }

        webView.settings.apply {

            // JavaScript
            javaScriptEnabled = true

            // Storage
            domStorageEnabled = true
            databaseEnabled = true

            // File access
            allowFileAccess = true
            allowContentAccess = true

            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true

            // TV Rendering
            useWideViewPort = true
            loadWithOverviewMode = true

            // Disable Zoom
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)

            // Better Rendering
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = false

            // Performance for TV hardware
            // (Hardware acceleration enabled on webView directly)
            
            // Avoid cache during development to ensure layout changes apply
            cacheMode = WebSettings.LOAD_NO_CACHE
            
            // Enable HTML5
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            
            // Allow local file access for USB-installed apps
            allowFileAccess = true
            allowContentAccess = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
        }

        webView.isHorizontalScrollBarEnabled = false
        webView.isVerticalScrollBarEnabled = false

        webView.webChromeClient = WebChromeClient()

        webView.webViewClient = object : WebViewClient() {

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)

                hideSystemUI()
            }
        }

        // Bridge
        webView.addJavascriptInterface(
            JsBridge(this),
            "Android",
        )

        // Support for high-density TV screens
        webView.settings.loadWithOverviewMode = true
        webView.settings.useWideViewPort = true

        // Load Dashboard
        webView.loadUrl("file:///android_asset/index.html")

        // Allow headless provisioning over ADB, e.g.
        //   adb shell am start -n com.stayvista.svdash/.MainActivity --es room 101
        applyRoomExtra(intent)

        // If no room is set (via manual setup or ADB), try auto-provisioning via IP.
        val currentRoom = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString(KEY_ROOM, null)
        if (currentRoom.isNullOrBlank()) {
            ProvisioningManager.getAutoRoomNumber()?.let { autoRoom ->
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit {
                    putString(KEY_ROOM, autoRoom)
                }
                syncRoomConfig()
            }
        }

        // The room number is provisioned per TV via the ADB extra above or the
        // on-screen setup prompt (stored in SharedPreferences); until it's set
        // we just show the static dashboard. The first cloud pull is kicked off
        // by onResume(), which also starts the repeating poll.

        // Check for a newer APK a few seconds after launch
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
            {
                UpdateManager.checkForUpdate(this)
            },
            5000,
        )

        // OPTIONAL:
        // To load from SD card instead:
        //
        // webView.loadUrl("file:///sdcard/HotelDashboard/index.html")

    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
        // A push from the Master app has to reach a TV that is already running,
        // so poll while the dashboard is on screen. Paused whenever the guest
        // is inside Netflix/YouTube/etc so we don't burn the Apps Script quota
        // for a dashboard nobody is looking at.
        pollHandler.removeCallbacks(pollRunnable)
        pollHandler.postDelayed(pollRunnable, RemoteConfigManager.POLL_INTERVAL_MS)
        // Catch anything pushed while we were backgrounded.
        syncRoomConfig()

        registerNetworkCallback()

        updateCheckHandler.removeCallbacks(updateCheckRunnable)
        updateCheckHandler.postDelayed(updateCheckRunnable, UpdateManager.CHECK_INTERVAL_MS)
    }

    override fun onPause() {
        super.onPause()
        pollHandler.removeCallbacks(pollRunnable)
        updateCheckHandler.removeCallbacks(updateCheckRunnable)
        unregisterNetworkCallback()
    }

    override fun onDestroy() {
        pollHandler.removeCallbacks(pollRunnable)
        updateCheckHandler.removeCallbacks(updateCheckRunnable)
        super.onDestroy()
    }

    private fun registerNetworkCallback() {
        try {
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivityManager.registerNetworkCallback(request, networkCallback)
        } catch (e: Exception) {
            // Already registered, or the platform rejected the request -- the
            // regular poll loop still covers us either way.
        }
    }

    private fun unregisterNetworkCallback() {
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (e: Exception) {
            // Wasn't registered -- nothing to clean up.
        }
    }

    /**
     * singleInstance means a fresh "am start --es room NNN" is delivered here
     * (not onCreate) when the dashboard is already running. Re-provision and
     * re-sync so a running TV can be re-assigned to a different room remotely.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyRoomExtra(intent)
        syncRoomConfig()
    }

    /**
     * If the launching intent carries a "room" string extra, persist it as
     * this TV's room number. Blank/missing extras are ignored so a plain
     * relaunch never wipes an already-provisioned room.
     */
    private fun applyRoomExtra(intent: Intent?) {
        val room = intent?.getStringExtra("room")?.trim()
        if (!room.isNullOrEmpty()) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit {
                putString(KEY_ROOM, room)
            }
        }
    }

    /**
     * Reads the provisioned room number and, if set, syncs this room's guest
     * data from the cloud then reloads the WebView. Safe to call repeatedly —
     * JsBridge.setRoomNumber() calls this right after the room is entered.
     */
    fun syncRoomConfig() {
        val room = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString(KEY_ROOM, null)
        if (room.isNullOrBlank()) return

        RemoteConfigManager.syncConfig(this, room) { changed ->
            // Only repaint when the guest data actually moved. Reloading on
            // every poll (or every failed poll) would flash the dashboard
            // once a minute for the whole stay.
            if (!changed) return@syncConfig
            runOnUiThread {
                if (::webView.isInitialized) webView.reload()
            }
        }

        // Promo images are global, not per-room, but ride the same poll cycle.
        PromoManager.syncPromos(this) { changed ->
            if (!changed) return@syncPromos
            runOnUiThread {
                if (::webView.isInitialized) webView.reload()
            }
        }
    }

    private fun hideSystemUI() {

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {

            window.insetsController?.apply {

                hide(
                    WindowInsets.Type.statusBars() or
                            WindowInsets.Type.navigationBars()
                )

                systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }

        } else {

            @Suppress("DEPRECATION")

            window.decorView.systemUiVisibility =

                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }

    }

    override fun onBackPressed() {

        // Prevent exiting dashboard

        if (webView.canGoBack()) {

            webView.goBack()

        } else {

            // Ignore back press

        }

    }
}