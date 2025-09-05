package com.mebloplan.scanner

import java.io.File
import java.io.IOException
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody

object Uploader {
    private val client = OkHttpClient()

    suspend fun upload(url: String, token: String, file: File, meta: Map<String, String>): String {
        val metaString = meta.entries.joinToString("&") { "${it.key}=${URLEncoder.encode(it.value, "UTF-8")}" }
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("meta", metaString)
            .addFormDataPart(
                name = "file",
                filename = file.name,
                body = file.asRequestBody("application/octet-stream".toMediaType())
            )
            .build()

        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .post(body)
            .build()

        return withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { resp ->
                val responseBody = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) throw IOException("HTTP ${'$'}{resp.code}: ${'$'}responseBody")
                responseBody
            }
        }
    }
}
