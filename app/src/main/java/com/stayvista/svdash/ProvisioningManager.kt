package com.stayvista.svdash

import android.util.Log
import java.net.Inet4Address
import java.net.NetworkInterface

object ProvisioningManager {

    private const val TAG = "Provisioning"

    private val IP_ROOM_MAP = mapOf(
        "192.168.10.17" to "101",
        "192.168.10.18" to "102",
        "192.168.10.19" to "103",
        "192.168.10.20" to "104",
        "192.168.10.21" to "105",
        "192.168.10.22" to "106",
        "192.168.10.23" to "107",
        "192.168.10.24" to "108",
        "192.168.10.25" to "109",

        "192.168.10.26" to "201",
        "192.168.10.27" to "202",
        "192.168.10.28" to "203",
        "192.168.10.29" to "204",
        "192.168.10.30" to "205",
        "192.168.10.31" to "206",
        "192.168.10.32" to "207",
        "192.168.10.33" to "208",
        "192.168.10.34" to "209",

        "192.168.10.35" to "301",
        "192.168.10.36" to "302",
        "192.168.10.37" to "303",
        "192.168.10.38" to "304",
        "192.168.10.39" to "305",
        "192.168.10.40" to "306",
        "192.168.10.41" to "307",
        "192.168.10.42" to "308",
        "192.168.10.43" to "309",

        "192.168.10.44" to "401",
        "192.168.10.45" to "402",
        "192.168.10.50" to "403",
        "192.168.10.47" to "404",
        "192.168.10.48" to "405",
        "192.168.10.49" to "406",
        "192.168.10.51" to "408",
        "192.168.10.52" to "409",

        "192.168.10.55" to "1001"
    )

    /**
     * Attempts to find a matching room number based on the device's local IP.
     */
    fun getAutoRoomNumber(): String? {
        val ip = getLocalIpAddress() ?: return null
        Log.d(TAG, "Local IP detected: $ip")
        return IP_ROOM_MAP[ip]
    }

    fun getLocalIpAddress(): String? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        return addr.hostAddress
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error getting IP: ${e.message}")
        }
        return null
    }
}
