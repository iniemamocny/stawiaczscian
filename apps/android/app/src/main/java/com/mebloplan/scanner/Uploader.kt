package com.mebloplan.scanner

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object Uploader {
    private val client =
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

    internal fun guessMimeType(file: File): String {
        return when (file.extension.lowercase()) {
            "obj" -> "model/obj"
            "ply" -> "model/x-ply"
            "usd", "usda" -> "application/usd"
            "usdz" -> "model/vnd.usdz+zip"
            else -> "application/octet-stream"
        }
    }

    suspend fun upload(
        url: String = BuildConfig.API_URL,
        token: String = BuildConfig.API_TOKEN,
        file: File,
        meta: Map<String, String>,
    ): String {
        val metaString =
            meta.entries.joinToString("&") {
                "${URLEncoder.encode(it.key, "UTF-8")}=${URLEncoder.encode(it.value, "UTF-8")}"
            }
        val mime = guessMimeType(file)
        val body =
            MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("meta", metaString)
                .addFormDataPart(
                    name = "file",
                    filename = file.name,
                    body = file.asRequestBody(mime.toMediaType()),
                )
                .build()

        val request =
            Request.Builder()
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
