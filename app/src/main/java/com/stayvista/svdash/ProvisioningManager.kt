package com.stayvista.svdash

import android.util.Log
import java.net.Inet4Address
import java.net.NetworkInterface

object ProvisioningManager {

    private const val TAG = "Provisioning"

    // Kept in sync with the "TV-Rooms DB" tab of the Master PMS sheet
    // (Room No. / DHCP / MAC). MAC noted per entry for reference since DHCP
    // leases can move; rooms 405 and 407 have no MAC on file yet in the sheet.
    private val IP_ROOM_MAP = mapOf(
        "192.168.10.17" to "101", // MAC C0-8A-60-E0-7C-E7
        "192.168.10.18" to "102", // MAC C0-8A-60-E0-53-FD
        "192.168.10.19" to "103", // MAC C0-8A-60-E0-AB-A5
        "192.168.10.20" to "104", // MAC C0-8A-60-E0-83-B5
        "192.168.10.21" to "105", // MAC C0-8A-60-E0-81-75
        "192.168.10.22" to "106", // MAC C0-8A-60-E0-93-61
        "192.168.10.23" to "107", // MAC C0-8A-60-E0-97-47
        "192.168.10.24" to "108", // MAC E0-22-A1-3B-6C-0A
        "192.168.10.25" to "109", // MAC C0-8A-60-E0-2F-23

        "192.168.10.26" to "201", // MAC C0-8A-60-E0-76-6F
        "192.168.10.27" to "202", // MAC E0-22-A1-3C-9A-42
        "192.168.10.28" to "203", // MAC C0-8A-60-E0-8F-E1
        "192.168.10.29" to "204", // MAC C0-8A-60-E0-67-65
        "192.168.10.30" to "205", // MAC C0-8A-60-E0-A5-61
        "192.168.10.31" to "206", // MAC C0-8A-60-DF-61-75
        "192.168.10.32" to "207", // MAC C0-8A-60-DF-E9-91
        "192.168.10.33" to "208", // MAC C0-8A-60-DF-DE-FB
        "192.168.10.34" to "209", // MAC C0-8A-60-DF-EB-A5

        "192.168.10.35" to "301", // MAC C0-8A-60-E0-B0-C5
        "192.168.10.36" to "302", // MAC C0-8A-60-E0-77-89
        "192.168.10.37" to "303", // MAC E0-22-A1-3D-05-DC
        "192.168.10.38" to "304", // MAC C0-8A-60-E0-98-5B
        "192.168.10.39" to "305", // MAC C0-8A-60-E0-80-A9
        "192.168.10.40" to "306", // MAC C0-8A-60-DF-EA-25
        "192.168.10.41" to "307", // MAC C0-8A-60-E0-0A-89
        "192.168.10.42" to "308", // MAC C0-8A-60-E0-6A-A5
        "192.168.10.43" to "309", // MAC C0-8A-60-DF-7B-8D

        "192.168.10.44" to "401", // MAC E0-22-A1-3D-24-2E
        "192.168.10.45" to "402", // MAC C0-8A-60-E0-62-39
        "192.168.10.46" to "403", // MAC C0-8A-60-DF-E6-D1
        "192.168.10.47" to "404", // MAC E0-22-A1-3C-97-48
        "192.168.10.48" to "405", // MAC not on file
        "192.168.10.54" to "406", // MAC 18-84-C1-31-77-46
        "192.168.10.50" to "407", // MAC not on file
        "192.168.10.49" to "408", // MAC E0-22-A1-3C-5D-8E
        "192.168.10.51" to "409", // MAC C0-8A-60-E0-93-B5

        "192.168.10.55" to "1001" // MAC C0-8A-60-DF-7D-49
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
