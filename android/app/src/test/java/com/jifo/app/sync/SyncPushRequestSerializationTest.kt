package com.jifo.app.sync

import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.network.ApiClientFactory
import com.jifo.app.network.InMemoryTokenStore
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SyncPushRequestSerializationTest {
    @Test fun retrofitSerializesSyncPushPayloadAndAuthorization() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"results":[]}"""))
        server.start()
        try {
            val api = ApiClientFactory.createForTest(server.url("/api/").toString(), InMemoryTokenStore("token-1", null))
            val request = SyncDtoMapper.toPushRequest(listOf(
                OutboxOperationEntity(
                    opId = "op-1",
                    entity = "note",
                    action = "create",
                    clientId = "client-1",
                    baseVersion = 0,
                    payloadJson = """{"content":{"blocks":[{"type":"paragraph","text":"hello"}]},"plainText":"hello"}""",
                    createdAt = "2026-06-01T00:00:00Z"
                )
            ))

            api.push(request)

            val recorded = server.takeRequest()
            val body = recorded.body.readUtf8()
            assertEquals("Bearer token-1", recorded.getHeader("Authorization"))
            assertTrue(body.contains("\"opId\":\"op-1\""))
            assertTrue(body.contains("\"plainText\":\"hello\""))
            assertTrue(body.contains("\"blocks\""))
        } finally {
            server.shutdown()
        }
    }
}
