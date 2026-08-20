package com.stayvista.master

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import okhttp3.*
import org.json.JSONObject
import java.io.File
import java.io.IOException

class InHouseFragment : Fragment() {

    private val API_URL = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec?room=ALL&key=${BuildConfig.DEVICE_KEY}"
    private lateinit var rvGuests: RecyclerView
    private lateinit var btnExport: Button
    private var guestList = mutableListOf<Guest>()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        val view = inflater.inflate(R.layout.fragment_inhouse, container, false)
        rvGuests = view.findViewById(R.id.rvGuests)
        rvGuests.layoutManager = LinearLayoutManager(context)
        btnExport = view.findViewById(R.id.btnExportGuests)
        btnExport.setOnClickListener { exportGuests() }

        loadData()
        return view
    }

    /** Shares the currently-loaded guest list as a CSV via the system share sheet. */
    private fun exportGuests() {
        if (guestList.isEmpty()) {
            Toast.makeText(context, "No guest data to export", Toast.LENGTH_SHORT).show()
            return
        }

        val csv = buildString {
            append("Room,Salutation,Last Name,Check-out\n")
            for (g in guestList) {
                append("${csvField(g.roomNo)},${csvField(g.salutation)},${csvField(g.lastName)},${csvField(g.checkout)}\n")
            }
        }

        val exportsDir = File(requireContext().cacheDir, "exports").apply { mkdirs() }
        val file = File(exportsDir, "inhouse_guests.csv")
        file.writeText(csv)

        val uri = FileProvider.getUriForFile(requireContext(), "${requireContext().packageName}.fileprovider", file)
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/csv"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(shareIntent, "Export guest list"))
    }

    /** Quotes a CSV field if it contains a comma, quote, or newline; doubles internal quotes. */
    private fun csvField(value: String): String {
        return if (value.any { it == ',' || it == '"' || it == '\n' }) {
            "\"${value.replace("\"", "\"\"")}\""
        } else {
            value
        }
    }

    private fun loadData() {
        val client = OkHttpClient()
        val request = Request.Builder().url(API_URL).get().build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                activity?.runOnUiThread {
                    Toast.makeText(context, "Error loading data", Toast.LENGTH_SHORT).show()
                }
            }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string()
                if (body != null) {
                    try {
                        val json = JSONObject(body)
                        guestList.clear()
                        val keys = json.keys()
                        while(keys.hasNext()) {
                            val roomNo = keys.next()
                            val guestObj = json.getJSONObject(roomNo).getJSONObject("guest")
                            guestList.add(Guest(
                                roomNo,
                                guestObj.getString("salutation"),
                                guestObj.getString("lastName"),
                                guestObj.getString("checkout")
                            ))
                        }
                        // roomNo isn't always numeric (e.g. cafe/common-area units like "TDR"
                        // from the onida app) -- sort those after the numbered rooms instead
                        // of letting toInt() throw and blank the whole list.
                        guestList.sortWith(compareBy({ it.roomNo.toIntOrNull() ?: Int.MAX_VALUE }, { it.roomNo }))
                        activity?.runOnUiThread {
                            rvGuests.adapter = GuestAdapter(guestList)
                        }
                    } catch (e: Exception) {
                        activity?.runOnUiThread {
                            Toast.makeText(context, "No active guests", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        })
    }

    data class Guest(val roomNo: String, val salutation: String, val lastName: String, val checkout: String)

    class GuestAdapter(private val guests: List<Guest>) : RecyclerView.Adapter<GuestAdapter.ViewHolder>() {
        class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val tvRoomTag: TextView = v.findViewById(R.id.tvRoomTag)
            val tvGuestFullName: TextView = v.findViewById(R.id.tvGuestFullName)
            val tvCheckoutInfo: TextView = v.findViewById(R.id.tvCheckoutInfo)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_guest, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val g = guests[position]
            holder.tvRoomTag.text = g.roomNo
            holder.tvGuestFullName.text = "${g.salutation} ${g.lastName}"
            holder.tvCheckoutInfo.text = "Check-out: ${g.checkout}"
        }

        override fun getItemCount() = guests.size
    }
}