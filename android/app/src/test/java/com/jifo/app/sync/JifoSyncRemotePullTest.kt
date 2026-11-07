package com.jifo.app.sync

import com.jifo.app.network.ApiClientFactory
import com.jifo.app.network.InMemoryTokenStore
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// M1:走真实 Retrofit + MockWebServer,验证 pull 端点返回原始响应体后,
// JifoSyncRemote 的解析层会跳过单条脏数据而不是打崩整页。
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class JifoSyncRemotePullTest {
    @Test fun pullSkipsDirtyEntriesFromServerResponse() = runTest {
        val server = MockWebServer()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""
                {
                  "notes": [],
                  "items": [
                    {"id": "good-1", "clientId": "c1", "version": 1},
                    {"id": "dirty", "clientId": null, "version": 1},
                    {"id": "good-2", "clientId": "c2", "version": 1}
                  ],
                  "cursor": {"updatedAt": "2026-06-01T00:00:00Z", "id": "good-2"},
                  "nextCursor": null
                }
            """.trimIndent())
        )
        server.start()

        try {
            val api = ApiClientFactory.createForTest(server.url("/api/").toString(), InMemoryTokenStore("token", null))
            val remote = JifoSyncRemote(api)

            val page = remote.pull(null, null, 100)

            assertEquals(listOf("good-1", "good-2"), page.items.map { it.id })
            assertEquals("2026-06-01T00:00:00Z", page.cursor?.updatedAt)
            assertEquals("/api/sync/pull", server.takeRequest().path?.substringBefore('?'))
        } finally {
            server.shutdown()
        }
    }
}
