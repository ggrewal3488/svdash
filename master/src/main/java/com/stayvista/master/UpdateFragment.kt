package com.stayvista.master

import android.app.DatePickerDialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.fragment.app.Fragment
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.*

class UpdateFragment : Fragment() {

    private val apiUrl = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec"

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        val view = inflater.inflate(R.layout.fragment_update, container, false)

        val etRoomNumber = view.findViewById<EditText>(R.id.etRoomNumber)
        val spSalutation = view.findViewById<Spinner>(R.id.spSalutation)
        val etLastName = view.findViewById<EditText>(R.id.etLastName)
        val etCheckin = view.findViewById<EditText>(R.id.etCheckin)
        val etCheckout = view.findViewById<EditText>(R.id.etCheckout)
        val etMessage = view.findViewById<EditText>(R.id.etMessage)
        val btnPush = view.findViewById<Button>(R.id.btnPush)

        val salutations = arrayOf("", "Mr.", "Ms.", "Mr. & Mrs.", "Dr.")
        spSalutation.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, salutations)

        if (!Session.canWrite(Session.TAB_UPDATE)) {
            listOf(etRoomNumber, spSalutation, etLastName, etCheckin, etCheckout, etMessage, btnPush)
                .forEach { it.isEnabled = false }
            return view
        }

        etCheckin.setOnClickListener { showDatePicker(etCheckin) }
        etCheckout.setOnClickListener { showDatePicker(etCheckout) }

        btnPush.setOnClickListener {
            if (etRoomNumber.text.isEmpty()) {
                Toast.makeText(context, "Please enter room number", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val data = JSONObject().apply {
                put("roomNo", etRoomNumber.text.toString())
                put("salutation", spSalutation.selectedItem.toString())
                put("lastName", etLastName.text.toString())
                put("checkin", etCheckin.text.toString())
                put("checkout", etCheckout.text.toString())
                put("message", etMessage.text.toString())
                Session.token?.let { put("token", it) }
            }

            btnPush.isEnabled = false
            pushData(
                data.toString(),
                etRoomNumber.text.toString().trim(),
                etLastName.text.toString().trim()
            ) { btnPush.isEnabled = true }
        }

        return view
    }

    private fun showDatePicker(editText: EditText) {
        val c = Calendar.getInstance()
        DatePickerDialog(
            requireContext(),
            { _, y, m, d ->
                val date = String.format(Locale.US, "%d-%02d-%02d", y, m + 1, d)
                editText.setText(date)
            },
            c.get(Calendar.YEAR),
            c.get(Calendar.MONTH),
            c.get(Calendar.DAY_OF_MONTH),
        ).show()
    }

    /**
     * Posts the guest record, then reads the room back to confirm it actually
     * landed. Apps Script answers 200 even when doPost() silently drops the
     * payload, so the HTTP status alone proves nothing -- the old code reported
     * "TV Updated!" on every push whether or not anything was saved.
     */
    private fun pushData(json: String, roomNo: String, lastName: String, onDone: () -> Unit) {
        val client = OkHttpClient.Builder()
            .followRedirects(followRedirects = true)
            .followSslRedirects(followProtocolRedirects = true)
            .build()

        val body = json.toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder().url(apiUrl).post(body).build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                report("Failed: ${e.message}", onDone)
            }

            override fun onResponse(call: Call, response: Response) {
                val respBody = response.use {
                    if (!it.isSuccessful) {
                        report("Server error: ${it.code}", onDone)
                        return
                    }
                    it.body?.string() ?: ""
                }
                // pushGuest_ answers 200 with { ok: false, error } when it
                // rejects the push -- most often a saved login token past its
                // 12-hour expiry, which sends the user back to log in. Show
                // any other reason instead of falling through to the generic
                // "did not save" from the read-back.
                val error = try {
                    val json = JSONObject(respBody)
                    if (json.optBoolean("ok", true)) null else json.optString("error", "unknown error")
                } catch (e: Exception) {
                    null
                }
                if (error != null) {
                    if (error.contains("session", ignoreCase = true)) {
                        activity?.runOnUiThread { (activity as? MainActivity)?.onSessionExpired() }
                    } else {
                        report("Push rejected for room $roomNo: $error", onDone)
                    }
                    return
                }
                verifySaved(client, roomNo, lastName, onDone)
            }
        })
    }

    /**
     * Reads the room back and checks the pushed name is really stored. The
     * login token goes along with the device key: either one satisfies
     * isAuthorizedRoomRequest_(), and a local build has an empty DEVICE_KEY.
     */
    private fun verifySaved(client: OkHttpClient, roomNo: String, lastName: String, onDone: () -> Unit) {
        val url = apiUrl.toHttpUrl().newBuilder()
            .addQueryParameter("room", roomNo)
            .addQueryParameter("key", BuildConfig.DEVICE_KEY)
            .addQueryParameter("t", System.currentTimeMillis().toString())
            .apply { Session.token?.let { addQueryParameter("token", it) } }
            .build()
        val request = Request.Builder().url(url).get().build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                report("Saved, but could not verify: ${e.message}", onDone)
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.use { it.body?.string() } ?: ""
                // A refused read-back says nothing about whether the push
                // landed -- don't report it as a failed save.
                if (body.contains("Unauthorized")) {
                    report("Room $roomNo pushed, but the read-back was refused — device key mismatch", onDone)
                    return
                }
                val saved = lastName.isEmpty() || body.contains(lastName, ignoreCase = true)
                if (saved) {
                    report("Room $roomNo saved — TV refreshes within a minute", onDone)
                } else {
                    report("Push did not save for room $roomNo — check the Apps Script", onDone)
                }
            }
        })
    }

    private fun report(message: String, onDone: () -> Unit) {
        activity?.runOnUiThread {
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            onDone()
        }
    }
}