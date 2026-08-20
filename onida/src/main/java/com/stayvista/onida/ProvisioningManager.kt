package com.stayvista.onida

import android.util.Log
import java.net.Inet4Address
import java.net.NetworkInterface

object ProvisioningManager {

    private const val TAG = "Provisioning"

    // Onida devices aren't part of svdash's IP_ROOM_MAP fleet (see app/'s
    // ProvisioningManager.kt) -- provision each one manually instead, e.g.
    //   adb shell am start -n com.stayvista.onida/.MainActivity --es room <n>
    private val IP_ROOM_MAP = emptyMap<String, String>()

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
