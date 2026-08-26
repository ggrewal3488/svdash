package com.stayvista.master

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

class LoginActivity : AppCompatActivity() {

    private val apiUrl = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec"
    private val client = OkHttpClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Session.restore(this)
        if (Session.isLoggedIn()) {
            goToMain()
            return
        }

        setContentView(R.layout.activity_login)

        val etUsername = findViewById<EditText>(R.id.etUsername)
        val etPassword = findViewById<EditText>(R.id.etPassword)
        val btnLogin = findViewById<Button>(R.id.btnLogin)
        val tvError = findViewById<TextView>(R.id.tvLoginError)
        val progress = findViewById<ProgressBar>(R.id.progressLogin)

        btnLogin.setOnClickListener {
            val username = etUsername.text.toString().trim()
            val password = etPassword.text.toString()
            if (username.isEmpty() || password.isEmpty()) {
                tvError.text = "Enter username and password"
                return@setOnClickListener
            }

            tvError.text = ""
            btnLogin.isEnabled = false
            progress.visibility = View.VISIBLE
            login(username, password, tvError, btnLogin, progress)
        }
    }

    private fun login(username: String, password: String, tvError: TextView, btnLogin: Button, progress: ProgressBar) {
        val data = JSONObject().apply {
            put("action", "login")
            put("username", username)
            put("password", password)
        }
        val body = data.toString().toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder().url(apiUrl).post(body).build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                report(tvError, btnLogin, progress, "Network error — try again")
            }

            override fun onResponse(call: Call, response: Response) {
                val respBody = response.use { it.body?.string() } ?: ""
                try {
                    val json = JSONObject(respBody)
                    if (json.optBoolean("ok", false)) {
                        Session.save(this@LoginActivity, json.getString("token"), json.getString("username"), json.getString("role"))
                        runOnUiThread { goToMain() }
                    } else {
                        report(tvError, btnLogin, progress, json.optString("error", "Login failed"))
                    }
                } catch (e: Exception) {
                    report(tvError, btnLogin, progress, "Unexpected server response")
                }
            }
        })
    }

    private fun report(tvError: TextView, btnLogin: Button, progress: ProgressBar, message: String) {
        runOnUiThread {
            tvError.text = message
            btnLogin.isEnabled = true
            progress.visibility = View.GONE
        }
    }

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
