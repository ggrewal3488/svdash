package com.stayvista.master

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

class MaintenanceFragment : Fragment() {

    private val apiUrl = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec"
    private val client = OkHttpClient()

    private lateinit var rvMaint: RecyclerView
    private lateinit var tvStatus: TextView
    private var tickets = mutableListOf<MaintTicket>()
    private var log = mutableListOf<MaintLogEntry>()
    private var showingLog = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        val view = inflater.inflate(R.layout.fragment_maintenance, container, false)
        rvMaint = view.findViewById(R.id.rvMaint)
        rvMaint.layoutManager = LinearLayoutManager(context)
        tvStatus = view.findViewById(R.id.tvMaintStatus)

        val raiseGroup = view.findViewById<LinearLayout>(R.id.maintRaiseGroup)
        val etLocation = view.findViewById<EditText>(R.id.etMaintLocation)
        val etIssue = view.findViewById<EditText>(R.id.etMaintIssue)
        val btnRaise = view.findViewById<Button>(R.id.btnMaintRaise)

        if (!Session.canWrite(Session.TAB_MAINTENANCE)) {
            raiseGroup.visibility = View.GONE
        } else {
            btnRaise.setOnClickListener {
                val location = etLocation.text.toString().trim()
                val issue = etIssue.text.toString().trim()
                if (location.isEmpty() || issue.isEmpty()) {
                    Toast.makeText(context, "Please enter a location and describe the issue", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                btnRaise.isEnabled = false
                raiseTicket(location, issue) {
                    btnRaise.isEnabled = true
                    etLocation.text.clear()
                    etIssue.text.clear()
                }
            }
        }

        view.findViewById<Button>(R.id.btnMaintShowOpen).setOnClickListener { showingLog = false; render() }
        view.findViewById<Button>(R.id.btnMaintShowLog).setOnClickListener { showingLog = true; render() }

        loadData()
        return view
    }

    private fun loadData() {
        tvStatus.text = "Loading…"
        val token = Session.token ?: ""
        val request = Request.Builder().url("$apiUrl?action=listMaintenance&token=$token").get().build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                activity?.runOnUiThread { tvStatus.text = "Could not load maintenance tickets" }
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.use { it.body?.string() } ?: ""
                try {
                    val json = JSONObject(body)
                    if (!json.optBoolean("ok", false)) {
                        activity?.runOnUiThread { tvStatus.text = json.optString("error", "Could not load maintenance tickets") }
                        return
                    }

                    tickets.clear()
                    val ticketsArr = json.optJSONArray("tickets")
                    if (ticketsArr != null) {
                        for (i in 0 until ticketsArr.length()) {
                            val t = ticketsArr.getJSONObject(i)
                            tickets.add(
                                MaintTicket(
                                    t.getString("ticketId"),
                                    t.getString("location"),
                                    t.getString("issue"),
                                    t.getString("status"),
                                    t.optString("updatedBy", "")
                                )
                            )
                        }
                    }

                    log.clear()
                    val logArr = json.optJSONArray("log")
                    if (logArr != null) {
                        for (i in 0 until logArr.length()) {
                            val l = logArr.getJSONObject(i)
                            log.add(
                                MaintLogEntry(
                                    l.getString("ticketId"),
                                    l.getString("location"),
                                    l.getString("issue"),
                                    l.getString("status"),
                                    l.optString("updatedBy", ""),
                                    l.optString("notes", ""),
                                    l.optString("timestamp", "")
                                )
                            )
                        }
                    }

                    activity?.runOnUiThread { render() }
                } catch (e: Exception) {
                    activity?.runOnUiThread { tvStatus.text = "No maintenance activity yet" }
                }
            }
        })
    }

    private fun render() {
        if (showingLog) {
            tvStatus.text = "${log.size} recent updates"
            rvMaint.adapter = MaintLogAdapter(log)
        } else {
            val open = tickets.count { it.status != "Resolved" }
            tvStatus.text = "$open open of ${tickets.size} tickets"
            rvMaint.adapter = MaintTicketAdapter(tickets) { ticketId, newStatus ->
                updateTicket(ticketId, newStatus)
            }
        }
    }

    private fun raiseTicket(location: String, issue: String, onDone: () -> Unit) {
        tvStatus.text = "Saving…"
        val data = JSONObject().apply {
            put("action", "createMaintenanceTicket")
            put("token", Session.token ?: "")
            put("location", location)
            put("issue", issue)
        }
        post(data, "Ticket raised") { onDone() }
    }

    private fun updateTicket(ticketId: String, status: String) {
        tvStatus.text = "Saving…"
        val data = JSONObject().apply {
            put("action", "updateMaintenanceTicket")
            put("token", Session.token ?: "")
            put("ticketId", ticketId)
            put("status", status)
        }
        post(data, "Ticket updated") {}
    }

    private fun post(data: JSONObject, successMessage: String, onDone: () -> Unit) {
        val body = data.toString().toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder().url(apiUrl).post(body).build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                report("Update failed: ${e.message}", onDone)
            }

            override fun onResponse(call: Call, response: Response) {
                val respBody = response.use { it.body?.string() } ?: ""
                val ok = try { JSONObject(respBody).optBoolean("ok", false) } catch (e: Exception) { false }
                if (ok) {
                    report(successMessage, onDone)
                    loadData()
                } else {
                    val error = try { JSONObject(respBody).optString("error", "Update failed") } catch (e: Exception) { "Update failed" }
                    report(error, onDone)
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

    data class MaintTicket(val ticketId: String, val location: String, val issue: String, val status: String, val updatedBy: String)
    data class MaintLogEntry(val ticketId: String, val location: String, val issue: String, val status: String, val updatedBy: String, val notes: String, val timestamp: String)

    class MaintTicketAdapter(
        private val tickets: List<MaintTicket>,
        private val onAction: (String, String) -> Unit
    ) : RecyclerView.Adapter<MaintTicketAdapter.ViewHolder>() {

        class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val tvLocation: TextView = v.findViewById(R.id.tvTicketLocation)
            val tvStatus: TextView = v.findViewById(R.id.tvTicketStatus)
            val tvIssue: TextView = v.findViewById(R.id.tvTicketIssue)
            val tvMeta: TextView = v.findViewById(R.id.tvTicketMeta)
            val actions: LinearLayout = v.findViewById(R.id.ticketActions)
            val btnInProgress: Button = v.findViewById(R.id.btnTicketInProgress)
            val btnResolve: Button = v.findViewById(R.id.btnTicketResolve)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_maintenance_ticket, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val t = tickets[position]
            holder.tvLocation.text = t.location
            holder.tvIssue.text = t.issue
            holder.tvStatus.text = t.status
            holder.tvMeta.text = "Updated by ${t.updatedBy}"

            val ctx = holder.itemView.context
            val (bgRes, colorRes) = statusColors(t.status)
            holder.tvStatus.setBackgroundResource(bgRes)
            holder.tvStatus.setTextColor(ContextCompat.getColor(ctx, colorRes))

            when (t.status) {
                "Resolved" -> holder.actions.visibility = View.GONE
                "In Progress" -> {
                    holder.actions.visibility = View.VISIBLE
                    holder.btnInProgress.visibility = View.GONE
                    holder.btnResolve.visibility = View.VISIBLE
                }
                else -> {
                    holder.actions.visibility = View.VISIBLE
                    holder.btnInProgress.visibility = View.VISIBLE
                    holder.btnResolve.visibility = View.VISIBLE
                }
            }
            holder.btnInProgress.setOnClickListener { onAction(t.ticketId, "In Progress") }
            holder.btnResolve.setOnClickListener { onAction(t.ticketId, "Resolved") }
        }

        override fun getItemCount() = tickets.size

        // Reuses the Housekeeping status chips: red = needs attention, gold =
        // in progress, green = done.
        private fun statusColors(status: String): Pair<Int, Int> = when (status) {
            "Open" -> R.drawable.bg_chip_danger to R.color.danger
            "In Progress" -> R.drawable.bg_chip_dirty to R.color.gold_light
            "Resolved" -> R.drawable.bg_chip_ready to R.color.ok
            else -> R.drawable.bg_chip to R.color.gold_light
        }
    }

    class MaintLogAdapter(private val entries: List<MaintLogEntry>) : RecyclerView.Adapter<MaintLogAdapter.ViewHolder>() {
        class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val tvTitle: TextView = v.findViewById(R.id.tvMaintLogTitle)
            val tvMeta: TextView = v.findViewById(R.id.tvMaintLogMeta)
            val tvNotes: TextView = v.findViewById(R.id.tvMaintLogNotes)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_maintenance_log, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val e = entries[position]
            holder.tvTitle.text = "${e.location} — ${e.issue} → ${e.status}"
            holder.tvMeta.text = "${e.updatedBy} · ${e.timestamp}"
            holder.tvNotes.text = e.notes
            holder.tvNotes.visibility = if (e.notes.isEmpty()) View.GONE else View.VISIBLE
        }

        override fun getItemCount() = entries.size
    }
}
