package com.stayvista.master

import android.content.Context

/**
 * Holds the logged-in session (token/username/role) in SharedPreferences.
 * Mirrors ROLE_CAPS in master/backend/Code.gs and master/web/app.js -- keep
 * all three in sync when a role or tab changes.
 */
object Session {
    private const val PREFS = "svMasterSession"
    private const val KEY_TOKEN = "token"
    private const val KEY_USERNAME = "username"
    private const val KEY_ROLE = "role"

    const val TAB_UPDATE = "update"
    const val TAB_INHOUSE = "inhouse"
    const val TAB_CONTENT = "content"
    const val TAB_HK = "hk"
    const val TAB_USERS = "users"
    const val TAB_MAINTENANCE = "maintenance"

    private data class RoleCaps(val tabs: List<String>, val write: List<String>)

    // Maintenance is deliberately open to every role in both tabs and write --
    // anyone on staff can raise or update a ticket, unlike every other tab
    // here. Keep this in sync with ROLE_CAPS in master/backend/Code.gs.
    private val ROLE_CAPS = mapOf(
        "Admin" to RoleCaps(
            tabs = listOf(TAB_UPDATE, TAB_INHOUSE, TAB_CONTENT, TAB_HK, TAB_USERS, TAB_MAINTENANCE),
            write = listOf(TAB_UPDATE, TAB_CONTENT, TAB_HK, TAB_USERS, TAB_MAINTENANCE)
        ),
        "Front Desk" to RoleCaps(
            tabs = listOf(TAB_UPDATE, TAB_INHOUSE, TAB_CONTENT, TAB_MAINTENANCE),
            write = listOf(TAB_UPDATE, TAB_CONTENT, TAB_MAINTENANCE)
        ),
        "Housekeeping" to RoleCaps(
            tabs = listOf(TAB_HK, TAB_MAINTENANCE),
            write = listOf(TAB_HK, TAB_MAINTENANCE)
        ),
        "BOH" to RoleCaps(
            tabs = listOf(TAB_UPDATE, TAB_INHOUSE, TAB_CONTENT, TAB_HK, TAB_USERS, TAB_MAINTENANCE),
            write = listOf(TAB_MAINTENANCE)
        )
    )

    var token: String? = null
        private set
    var username: String? = null
        private set
    var role: String? = null
        private set

    fun restore(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        token = prefs.getString(KEY_TOKEN, null)
        username = prefs.getString(KEY_USERNAME, null)
        role = prefs.getString(KEY_ROLE, null)
    }

    fun save(context: Context, token: String, username: String, role: String) {
        this.token = token
        this.username = username
        this.role = role
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USERNAME, username)
            .putString(KEY_ROLE, role)
            .apply()
    }

    fun clear(context: Context) {
        token = null
        username = null
        role = null
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun isLoggedIn(): Boolean = !token.isNullOrEmpty()

    fun visibleTabs(): List<String> = ROLE_CAPS[role]?.tabs ?: emptyList()

    fun canWrite(tab: String): Boolean = ROLE_CAPS[role]?.write?.contains(tab) ?: false
}
