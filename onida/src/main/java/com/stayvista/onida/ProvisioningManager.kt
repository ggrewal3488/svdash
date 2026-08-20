package com.stayvista.onida

import android.util.Log
import java.net.Inet4Address
import java.net.NetworkInterface

object ProvisioningManager {

    private const val TAG = "Provisioning"

    // Onida devices aren't part of svdash's IP_ROOM_MAP fleet (see app/'s
    // ProvisioningManager.kt) -- add each one here as it's provisioned, MAC
    // noted for reference since these are cafe/common-area units, not
    // numbered guest rooms:
    //   192.168.10.60 = 1002 (The Drawing Room cafe), MAC D0-76-02-A1-EA-4D
    private val IP_ROOM_MAP = mapOf(
        "192.168.10.60" to "1002"
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
