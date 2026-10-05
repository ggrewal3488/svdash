package com.stayvista.master

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.google.android.material.tabs.TabLayout
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private val apiUrl = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec"

    private lateinit var tabs: List<String>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Session.restore(this)
        if (!Session.isLoggedIn()) {
            goToLogin()
            return
        }

        setContentView(R.layout.activity_main)

        tabs = Session.visibleTabs()
        if (tabs.isEmpty()) {
            // A role with no tabs granted shouldn't be able to see a blank
            // dashboard -- treat it the same as a bad/expired session.
            Session.clear(this)
            goToLogin()
            return
        }

        findViewById<TextView>(R.id.tvUserLabel).text = "${Session.username} · ${Session.role}"
        findViewById<Button>(R.id.btnLogout).setOnClickListener {
            Session.clear(this)
            goToLogin()
        }

        val tabLayout = findViewById<TabLayout>(R.id.tabLayout)
        tabs.forEach { tab -> tabLayout.addTab(tabLayout.newTab().setText(tabLabel(tab))) }

        showFragment(fragmentFor(tabs[0]))

        tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab?) {
                val name = tabs.getOrNull(tab?.position ?: 0) ?: return
                showFragment(fragmentFor(name))
            }

            override fun onTabUnselected(tab: TabLayout.Tab?) {}
            override fun onTabReselected(tab: TabLayout.Tab?) {}
        })
    }

    private fun tabLabel(tab: String): String = when (tab) {
        Session.TAB_UPDATE -> "UPDATE TV"
        Session.TAB_INHOUSE -> "IN-HOUSE"
        Session.TAB_CONTENT -> "CONTENT"
        Session.TAB_HK -> "HOUSEKEEPING"
        Session.TAB_USERS -> "USERS"
        Session.TAB_MAINTENANCE -> "MAINTENANCE"
        else -> tab.uppercase()
    }

    private fun fragmentFor(tab: String): Fragment = when (tab) {
        Session.TAB_UPDATE -> UpdateFragment()
        Session.TAB_INHOUSE -> InHouseFragment()
        Session.TAB_CONTENT -> ContentFragment()
        Session.TAB_HK -> HkFragment()
        Session.TAB_USERS -> UsersFragment()
        Session.TAB_MAINTENANCE -> MaintenanceFragment()
        else -> UpdateFragment()
    }

    private fun showFragment(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragment_container, fragment)
            .commit()
    }

    override fun onResume() {
        super.onResume()
        if (Session.isLoggedIn()) verifySession()
    }

    /**
     * The saved token outlives the server's 12-hour TOKEN_TTL_MS, and an
     * expired one makes Code.gs reject every write (guest pushes included)
     * while the dashboard still looks logged in. Ask the server each time the
     * app comes to the foreground; a network failure proves nothing, so only
     * an explicit { ok: false } sends the user back to the login screen.
     */
    private fun verifySession() {
        val token = Session.token ?: return
        val request = Request.Builder().url("$apiUrl?action=verify&token=$token").get().build()
        OkHttpClient().newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}

            override fun onResponse(call: Call, response: Response) {
                val body = response.use { it.body?.string() } ?: ""
                val rejected = try {
                    val json = JSONObject(body)
                    json.has("ok") && !json.getBoolean("ok")
                } catch (e: Exception) {
                    false
                }
                if (rejected) runOnUiThread { onSessionExpired() }
            }
        })
    }

    /** Drops the saved session and returns to the login screen. */
    fun onSessionExpired() {
        if (isFinishing) return
        Toast.makeText(this, "Session expired — please sign in again", Toast.LENGTH_LONG).show()
        Session.clear(this)
        goToLogin()
    }

    private fun goToLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}
