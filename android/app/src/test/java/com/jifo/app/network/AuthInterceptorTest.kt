package com.jifo.app.network

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthInterceptorTest {
    @Test fun refreshesTokenAndRetriesUnauthorizedRequest() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":{\"code\":\"unauthorized\"}}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"accessToken\":\"new-access\",\"refreshToken\":\"new-refresh\",\"user\":{\"id\":\"u1\",\"email\":\"a@example.com\",\"username\":\"A\"}}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"total\":42}"))
        server.start()

        val session = InMemoryTokenStore(accessToken = "old-access", refreshToken = "old-refresh")
        val api = ApiClientFactory.createForTest(server.url("/api/").toString(), session)

        val stats = api.noteStats()

        assertEquals(42, stats.total)
        assertEquals("Bearer old-access", server.takeRequest().getHeader("Authorization"))
        assertEquals("/api/auth/refresh", server.takeRequest().path)
        assertEquals("Bearer new-access", server.takeRequest().getHeader("Authorization"))
        server.shutdown()
    }
}
