package com.stayvista.master

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.google.android.material.tabs.TabLayout

class MainActivity : AppCompatActivity() {

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

    private fun goToLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}
