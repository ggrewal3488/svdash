package com.stayvista.master

import android.os.Bundle
import android.text.InputType
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

class UsersFragment : Fragment() {

    private val apiUrl = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec"
    private val client = OkHttpClient()
    private val roles = arrayOf("Admin", "Front Desk", "Housekeeping", "BOH")

    private lateinit var rvUsers: RecyclerView
    private lateinit var tvStatus: TextView
    private var users = mutableListOf<UserRow>()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        val view = inflater.inflate(R.layout.fragment_users, container, false)
        rvUsers = view.findViewById(R.id.rvUsers)
        rvUsers.layoutManager = LinearLayoutManager(context)
        tvStatus = view.findViewById(R.id.tvUsersStatus)

        val addGroup = view.findViewById<LinearLayout>(R.id.addUserGroup)
        val etUsername = view.findViewById<EditText>(R.id.etNewUsername)
        val etPassword = view.findViewById<EditText>(R.id.etNewPassword)
        val spRole = view.findViewById<Spinner>(R.id.spNewRole)
        val btnCreate = view.findViewById<Button>(R.id.btnCreateUser)

        spRole.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, roles)

        if (!Session.canWrite(Session.TAB_USERS)) {
            addGroup.visibility = View.GONE
        } else {
            btnCreate.setOnClickListener {
                val username = etUsername.text.toString().trim()
                val password = etPassword.text.toString()
                if (username.isEmpty() || password.isEmpty()) {
                    Toast.makeText(context, "Username and password are required", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                btnCreate.isEnabled = false
                createUser(username, password, spRole.selectedItem.toString()) {
                    btnCreate.isEnabled = true
                    etUsername.text.clear()
                    etPassword.text.clear()
                }
            }
        }

        loadData()
        return view
    }

    private fun loadData() {
        tvStatus.text = "Loading…"
        val token = Session.token ?: ""
        val request = Request.Builder().url("$apiUrl?action=listUsers&token=$token").get().build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                activity?.runOnUiThread { tvStatus.text = "Could not load users" }
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.use { it.body?.string() } ?: ""
                try {
                    val json = JSONObject(body)
                    if (!json.optBoolean("ok", false)) {
                        activity?.runOnUiThread { tvStatus.text = json.optString("error", "Could not load users") }
                        return
                    }
                    users.clear()
                    val arr = json.optJSONArray("users")
                    if (arr != null) {
                        for (i in 0 until arr.length()) {
                            val u = arr.getJSONObject(i)
                            users.add(UserRow(u.getString("username"), u.getString("role"), u.optString("createdAt", "")))
                        }
                    }
                    activity?.runOnUiThread {
                        tvStatus.text = "${users.size} users"
                        // Only a role that can write the Users tab (Admin) gets
                        // tap-to-edit; BOH sees the same list read-only.
                        val onEdit = if (Session.canWrite(Session.TAB_USERS)) ::showEditDialog else null
                        rvUsers.adapter = UserAdapter(users, onEdit)
                    }
                } catch (e: Exception) {
                    activity?.runOnUiThread { tvStatus.text = "No users yet" }
                }
            }
        })
    }

    private fun createUser(username: String, password: String, role: String, onDone: () -> Unit) {
        tvStatus.text = "Creating…"
        val data = JSONObject().apply {
            put("action", "createUser")
            put("token", Session.token ?: "")
            put("newUsername", username)
            put("newPassword", password)
            put("role", role)
        }
        val body = data.toString().toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder().url(apiUrl).post(body).build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                report("Network error: ${e.message}", onDone)
            }

            override fun onResponse(call: Call, response: Response) {
                val respBody = response.use { it.body?.string() } ?: ""
                val ok = try { JSONObject(respBody).optBoolean("ok", false) } catch (e: Exception) { false }
                if (ok) {
                    report("User created", onDone)
                    loadData()
                } else {
                    val error = try { JSONObject(respBody).optString("error", "Could not create user") } catch (e: Exception) { "Could not create user" }
                    report(error, onDone)
                }
            }
        })
    }

    /** Role picker + optional new password for an existing account. */
    private fun showEditDialog(user: UserRow) {
        val ctx = requireContext()
        val pad = (20 * resources.displayMetrics.density).toInt()

        val spRole = Spinner(ctx).apply {
            adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_dropdown_item, roles)
            setSelection(roles.indexOf(user.role).coerceAtLeast(0))
        }
        val etPassword = EditText(ctx).apply {
            hint = "New password (blank = keep current)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val form = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad / 2, pad, 0)
            addView(spRole)
            addView(etPassword)
        }

        AlertDialog.Builder(ctx)
            .setTitle("Edit ${user.username}")
            .setView(form)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val password = etPassword.text.toString()
                if (password.isNotEmpty() && password.length < 6) {
                    Toast.makeText(context, "Password must be at least 6 characters", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                updateUser(user.username, spRole.selectedItem.toString(), password)
            }
            .show()
    }

    private fun updateUser(username: String, role: String, password: String) {
        tvStatus.text = "Saving…"
        val data = JSONObject().apply {
            put("action", "updateUser")
            put("token", Session.token ?: "")
            put("username", username)
            put("role", role)
            if (password.isNotEmpty()) put("newPassword", password)
        }
        val body = data.toString().toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder().url(apiUrl).post(body).build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                report("Network error: ${e.message}") {}
            }

            override fun onResponse(call: Call, response: Response) {
                val respBody = response.use { it.body?.string() } ?: ""
                val ok = try { JSONObject(respBody).optBoolean("ok", false) } catch (e: Exception) { false }
                if (ok) {
                    report("User updated") {}
                    loadData()
                } else {
                    val error = try { JSONObject(respBody).optString("error", "Could not update user") } catch (e: Exception) { "Could not update user" }
                    report(error) {}
                }
            }
        })
    }

    private fun report(message: String, onDone: () -> Unit) {
        activity?.runOnUiThread {
            tvStatus.text = message
            onDone()
        }
    }

    data class UserRow(val username: String, val role: String, val createdAt: String)

    class UserAdapter(
        private val users: List<UserRow>,
        private val onEdit: ((UserRow) -> Unit)?
    ) : RecyclerView.Adapter<UserAdapter.ViewHolder>() {
        class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val tvName: TextView = v.findViewById(R.id.tvUserName)
            val tvCreated: TextView = v.findViewById(R.id.tvUserCreated)
            val tvRole: TextView = v.findViewById(R.id.tvUserRole)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_user, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val u = users[position]
            holder.tvName.text = u.username
            holder.tvCreated.text = "Created ${u.createdAt}"
            holder.tvRole.text = u.role
            holder.itemView.setOnClickListener(onEdit?.let { edit -> View.OnClickListener { edit(u) } })
        }

        override fun getItemCount() = users.size
    }
}
