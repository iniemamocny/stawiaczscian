package com.mebloplan.scanner

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class UploaderTest {
    @Test
    fun encodesMetaValues() =
        runBlocking {
            val server = MockWebServer()
            server.enqueue(MockResponse().setBody("ok"))
            server.start()
            val file = File.createTempFile("test", ".txt").apply { writeText("data") }
            val result =
                Uploader.upload(
                    url = server.url("/upload").toString(),
                    token = "token",
                    file = file,
                    meta = mapOf("author" to "Jan Kowalski"),
                )
            val recorded = server.takeRequest()
            assertEquals("ok", result)
            assertTrue(recorded.body.readUtf8().contains("author=Jan+Kowalski"))
            server.shutdown()
        }

    @Test
    fun encodesMetaKeys() =
        runBlocking {
            val server = MockWebServer()
            server.enqueue(MockResponse().setBody("ok"))
            server.start()
            val file = File.createTempFile("test", ".txt").apply { writeText("data") }
            val result =
                Uploader.upload(
                    url = server.url("/upload").toString(),
                    token = "token",
                    file = file,
                    meta = mapOf("author name" to "Jan"),
                )
            val recorded = server.takeRequest()
            assertEquals("ok", result)
            assertTrue(recorded.body.readUtf8().contains("author+name=Jan"))
            server.shutdown()
        }

    @Test
    fun mapsExtensionsToMimeTypes() {
        val cases =
            mapOf(
                "model.ply" to "model/x-ply",
                "model.obj" to "model/obj",
                "model.usd" to "application/usd",
                "model.usda" to "application/usd",
                "model.usdz" to "model/vnd.usdz+zip",
                "model.bin" to "application/octet-stream",
            )

        for ((name, expected) in cases) {
            val mime = Uploader.guessMimeType(File(name))
            assertEquals(expected, mime, "extension ${'$'}{File(name).extension}")
        }
    }
}
