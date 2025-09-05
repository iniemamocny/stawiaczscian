
package com.mebloplan.scanner

import java.io.DataOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object Uploader {
    fun upload(url: String, token: String, file: File, meta: Map<String, String>): String {
        val boundary = "Boundary-" + System.currentTimeMillis()
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        }

        val out = DataOutputStream(conn.outputStream)

        // meta
        out.writeBytes("--$boundary\r\n")
        out.writeBytes("Content-Disposition: form-data; name=\"meta\"\r\n\r\n")
        out.writeBytes(meta.entries.joinToString("&") { it.key + "=" + it.value })
        out.writeBytes("\r\n")

        // file
        out.writeBytes("--$boundary\r\n")
        out.writeBytes("Content-Disposition: form-data; name=\"file\"; filename=\"${file.name}\"\r\n")
        out.writeBytes("Content-Type: application/octet-stream\r\n\r\n")
        file.inputStream().use { it.copyTo(out) }
        out.writeBytes("\r\n--$boundary--\r\n")
        out.flush()
        out.close()

        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        return stream.bufferedReader().readText()
    }
}
