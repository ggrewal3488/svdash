package com.stayvista.svdash

import java.net.HttpURLConnection
import java.net.URL

object HttpUtil {
    private const val MAX_REDIRECTS = 5

    /**
     * Opens [urlString] and manually follows redirects (Google serves multiple
     * hops for Apps Script/Drive URLs). Returns the connection positioned at
     * its final response code -- caller is responsible for disconnecting it.
     */
    fun openFollowingRedirects(urlString: String, timeoutMs: Int = 15000): HttpURLConnection {
        var connection = URL(urlString).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = timeoutMs
        connection.readTimeout = timeoutMs

        var responseCode = connection.responseCode
        var hops = 0
        while (responseCode / 100 == 3 && hops++ < MAX_REDIRECTS) {
            val newUrl = connection.getHeaderField("Location") ?: break
            connection.disconnect()
            connection = URL(newUrl).openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            responseCode = connection.responseCode
        }
        return connection
    }
}
