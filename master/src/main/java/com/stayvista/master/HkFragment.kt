package com.stayvista.master

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

class HkFragment : Fragment() {

    private val apiUrl = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec"
    private val client = OkHttpClient()
    private val statuses = arrayOf("Vacant Ready", "Vacant Dirty", "Occupied", "Maintenance", "Out of Order")

    private lateinit var rvHk: RecyclerView
    private lateinit var tvStatus: TextView
    private var rooms = mutableListOf<HkRoom>()
    private var log = mutableListOf<HkLogEntry>()
    private var showingLog = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        val view = inflater.inflate(R.layout.fragment_hk, container, false)
        rvHk = view.findViewById(R.id.rvHk)
        rvHk.layoutManager = LinearLayoutManager(context)
        tvStatus = view.findViewById(R.id.tvHkStatus)

        val updateGroup = view.findViewById<LinearLayout>(R.id.hkUpdateGroup)
        val etRoomNumber = view.findViewById<EditText>(R.id.etHkRoomNumber)
        val spStatus = view.findViewById<Spinner>(R.id.spHkStatus)
        val etNotes = view.findViewById<EditText>(R.id.etHkNotes)
        val btnUpdate = view.findViewById<Button>(R.id.btnHkUpdate)

        spStatus.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, statuses)

        if (!Session.canWrite(Session.TAB_HK)) {
            updateGroup.visibility = View.GONE
        } else {
            btnUpdate.setOnClickListener {
                val roomNo = etRoomNumber.text.toString().trim()
                if (roomNo.isEmpty()) {
                    Toast.makeText(context, "Please enter room number", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                btnUpdate.isEnabled = false
                updateStatus(roomNo, spStatus.selectedItem.toString(), etNotes.text.toString().trim()) {
                    btnUpdate.isEnabled = true
                    etRoomNumber.text.clear()
                    etNotes.text.clear()
                }
            }
        }

        view.findViewById<Button>(R.id.btnHkShowRooms).setOnClickListener { showingLog = false; render() }
        view.findViewById<Button>(R.id.btnHkShowLog).setOnClickListener { showingLog = true; render() }

        loadData()
        return view
    }

    private fun loadData() {
        tvStatus.text = "Loading…"
        val token = Session.token ?: ""
        val request = Request.Builder().url("$apiUrl?action=listHousekeeping&token=$token").get().build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                activity?.runOnUiThread { tvStatus.text = "Could not load housekeeping data" }
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.use { it.body?.string() } ?: ""
                try {
                    val json = JSONObject(body)
                    if (!json.optBoolean("ok", false)) {
                        activity?.runOnUiThread { tvStatus.text = json.optString("error", "Could not load housekeeping data") }
                        return
                    }

                    rooms.clear()
                    val roomsArr = json.optJSONArray("rooms")
                    if (roomsArr != null) {
                        for (i in 0 until roomsArr.length()) {
                            val r = roomsArr.getJSONObject(i)
                            rooms.add(HkRoom(r.getString("roomNo"), r.getString("status"), r.optString("updatedBy", "")))
                        }
                    }

                    log.clear()
                    val logArr = json.optJSONArray("log")
                    if (logArr != null) {
                        for (i in 0 until logArr.length()) {
                            val l = logArr.getJSONObject(i)
                            log.add(HkLogEntry(l.getString("roomNo"), l.getString("status"), l.optString("updatedBy", ""), l.optString("notes", ""), l.optString("timestamp", "")))
                        }
                    }

                    activity?.runOnUiThread { render() }
                } catch (e: Exception) {
                    activity?.runOnUiThread { tvStatus.text = "No housekeeping activity yet" }
                }
            }
        })
    }

    private fun render() {
        if (showingLog) {
            tvStatus.text = "${log.size} recent updates"
            rvHk.adapter = HkLogAdapter(log)
        } else {
            tvStatus.text = "${rooms.size} rooms logged"
            rvHk.adapter = HkRoomAdapter(rooms)
        }
    }

    private fun updateStatus(roomNo: String, status: String, notes: String, onDone: () -> Unit) {
        tvStatus.text = "Saving…"
        val data = JSONObject().apply {
            put("action", "updateHousekeeping")
            put("token", Session.token ?: "")
            put("roomNo", roomNo)
            put("status", status)
            put("notes", notes)
        }
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
                    report("Room $roomNo updated", onDone)
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

    data class HkRoom(val roomNo: String, val status: String, val updatedBy: String)
    data class HkLogEntry(val roomNo: String, val status: String, val updatedBy: String, val notes: String, val timestamp: String)

    class HkRoomAdapter(private val rooms: List<HkRoom>) : RecyclerView.Adapter<HkRoomAdapter.ViewHolder>() {
        class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val tvTag: TextView = v.findViewById(R.id.tvHkRoomTag)
            val tvStatus: TextView = v.findViewById(R.id.tvHkRoomStatus)
            val tvMeta: TextView = v.findViewById(R.id.tvHkRoomMeta)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_hk_room, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val r = rooms[position]
            holder.tvTag.text = r.roomNo
            holder.tvStatus.text = r.status
            holder.tvMeta.text = "Updated by ${r.updatedBy}"
        }

        override fun getItemCount() = rooms.size
    }

    class HkLogAdapter(private val entries: List<HkLogEntry>) : RecyclerView.Adapter<HkLogAdapter.ViewHolder>() {
        class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val tvTitle: TextView = v.findViewById(R.id.tvHkLogTitle)
            val tvMeta: TextView = v.findViewById(R.id.tvHkLogMeta)
            val tvNotes: TextView = v.findViewById(R.id.tvHkLogNotes)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_hk_log, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val e = entries[position]
            holder.tvTitle.text = "Room ${e.roomNo} → ${e.status}"
            holder.tvMeta.text = "${e.updatedBy} · ${e.timestamp}"
            holder.tvNotes.text = e.notes
            holder.tvNotes.visibility = if (e.notes.isEmpty()) View.GONE else View.VISIBLE
        }

        override fun getItemCount() = entries.size
    }
}
