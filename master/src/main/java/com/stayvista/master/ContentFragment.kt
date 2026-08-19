package com.stayvista.master

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

class ContentFragment : Fragment() {

    private val apiUrl = "https://script.google.com/macros/s/AKfycbxRb032fWp2LCcF0EDWJ-AcHVvUs_gRBD4obQsV14YE1Cf80DwEoqGpe21Njzku3R6vRQ/exec"
    private val client = OkHttpClient()

    private val maxPromoBytes = 5 * 1024 * 1024
    private val maxActivePromos = 5
    private val allowedMimeTypes = setOf("image/jpeg", "image/png")

    private lateinit var rvPromos: RecyclerView
    private lateinit var tvStatus: TextView
    private lateinit var btnAddImage: Button
    private var promoList = mutableListOf<Promo>()

    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) handlePickedImage(uri)
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        val view = inflater.inflate(R.layout.fragment_content, container, false)
        rvPromos = view.findViewById(R.id.rvPromos)
        rvPromos.layoutManager = LinearLayoutManager(context)
        tvStatus = view.findViewById(R.id.tvContentStatus)
        btnAddImage = view.findViewById(R.id.btnAddImage)

        btnAddImage.setOnClickListener {
            if (promoList.size >= maxActivePromos) {
                Toast.makeText(context, "Maximum of $maxActivePromos images already uploaded — delete one first", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            pickImage.launch("image/*")
        }

        loadData()
        return view
    }

    private fun loadData() {
        tvStatus.text = "Loading…"
        val request = Request.Builder().url("$apiUrl?action=getPromos").get().build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                activity?.runOnUiThread { tvStatus.text = "Could not load content" }
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.use { it.body?.string() } ?: ""
                try {
                    val json = JSONObject(body)
                    val promosArr = json.optJSONArray("promos")
                    promoList.clear()
                    if (promosArr != null) {
                        for (i in 0 until promosArr.length()) {
                            val p = promosArr.getJSONObject(i)
                            promoList.add(Promo(p.getString("id"), p.getString("url"), p.optInt("order", i)))
                        }
                    }
                    promoList.sortBy { it.order }
                    activity?.runOnUiThread {
                        tvStatus.text = "${promoList.size} of $maxActivePromos images active"
                        rvPromos.adapter = PromoAdapter(promoList, client) { id -> deletePromo(id) }
                    }
                } catch (e: Exception) {
                    activity?.runOnUiThread { tvStatus.text = "No promotional images yet" }
                }
            }
        })
    }

    private fun handlePickedImage(uri: Uri) {
        val resolver = requireContext().contentResolver
        val mimeType = resolver.getType(uri) ?: ""
        if (mimeType !in allowedMimeTypes) {
            Toast.makeText(context, "Only JPG or PNG images are allowed", Toast.LENGTH_LONG).show()
            return
        }

        val bytes = try {
            resolver.openInputStream(uri)?.use { it.readBytes() }
        } catch (e: Exception) {
            null
        }
        if (bytes == null) {
            Toast.makeText(context, "Could not read the selected image", Toast.LENGTH_LONG).show()
            return
        }
        if (bytes.size > maxPromoBytes) {
            Toast.makeText(context, "Image exceeds the 5MB size limit", Toast.LENGTH_LONG).show()
            return
        }

        uploadPromo(bytes, mimeType)
    }

    private fun uploadPromo(bytes: ByteArray, mimeType: String) {
        tvStatus.text = "Uploading…"
        btnAddImage.isEnabled = false

        val data = JSONObject().apply {
            put("action", "pushPromo")
            put("imageBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            put("mimeType", mimeType)
            put("filename", "promo")
        }

        val body = data.toString().toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder().url(apiUrl).post(body).build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                report("Upload failed: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val respBody = response.use { it.body?.string() } ?: ""
                val ok = try { JSONObject(respBody).optBoolean("ok", false) } catch (e: Exception) { false }
                if (ok) {
                    report("Uploaded")
                    loadData()
                } else {
                    val error = try { JSONObject(respBody).optString("error", "Upload failed") } catch (e: Exception) { "Upload failed" }
                    report(error)
                }
            }
        })
    }

    private fun deletePromo(id: String) {
        tvStatus.text = "Deleting…"
        val data = JSONObject().apply {
            put("action", "deletePromo")
            put("id", id)
        }
        val body = data.toString().toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder().url(apiUrl).post(body).build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                report("Delete failed: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val respBody = response.use { it.body?.string() } ?: ""
                val ok = try { JSONObject(respBody).optBoolean("ok", false) } catch (e: Exception) { false }
                if (ok) {
                    report("Deleted")
                    loadData()
                } else {
                    report("Delete failed")
                }
            }
        })
    }

    private fun report(message: String) {
        activity?.runOnUiThread {
            btnAddImage.isEnabled = true
            tvStatus.text = message
            Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
        }
    }

    data class Promo(val id: String, val url: String, val order: Int)

    class PromoAdapter(
        private val promos: List<Promo>,
        private val client: OkHttpClient,
        private val onDelete: (String) -> Unit
    ) : RecyclerView.Adapter<PromoAdapter.ViewHolder>() {

        class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val ivThumb: ImageView = v.findViewById(R.id.ivPromoThumb)
            val tvOrder: TextView = v.findViewById(R.id.tvPromoOrder)
            val btnDelete: Button = v.findViewById(R.id.btnDeletePromo)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_promo, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val promo = promos[position]
            holder.tvOrder.text = "Promo #${promo.order}"
            holder.ivThumb.setImageBitmap(null)
            holder.btnDelete.setOnClickListener { onDelete(promo.id) }
            loadThumbnail(promo.url, holder.ivThumb)
        }

        private fun loadThumbnail(url: String, imageView: ImageView) {
            imageView.setTag(R.id.ivPromoThumb, url)
            val request = Request.Builder().url(url).get().build()
            client.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {}
                override fun onResponse(call: Call, response: Response) {
                    val bytes = response.use { it.body?.bytes() } ?: return
                    val bitmap: Bitmap? = try {
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    } catch (e: Exception) {
                        null
                    }
                    if (bitmap != null) {
                        imageView.post {
                            if (imageView.getTag(R.id.ivPromoThumb) == url) {
                                imageView.setImageBitmap(bitmap)
                            }
                        }
                    }
                }
            })
        }

        override fun getItemCount() = promos.size
    }
}
