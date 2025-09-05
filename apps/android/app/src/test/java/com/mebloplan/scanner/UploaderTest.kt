package com.mebloplan.scanner

import java.io.File
import kotlin.test.assertTrue
import kotlin.test.assertEquals
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Test

class UploaderTest {
    @Test
    fun encodesMetaValues() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("ok"))
        server.start()
        val file = File.createTempFile("test", ".txt").apply { writeText("data") }
        val result = Uploader.upload(
            url = server.url("/upload").toString(),
            token = "token",
            file = file,
            meta = mapOf("author" to "Jan Kowalski")
        )
        val recorded = server.takeRequest()
        assertEquals("ok", result)
        assertTrue(recorded.body.readUtf8().contains("author=Jan+Kowalski"))
        server.shutdown()
    }
}
