package com.jifo.app.network

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

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

    @Test fun coalescesConcurrentRefreshesAndRetriesWithSingleNewToken() = runTest {
        val server = MockWebServer()
        val refreshCalls = AtomicInteger(0)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                return when {
                    request.path == "/api/auth/refresh" -> {
                        refreshCalls.incrementAndGet()
                        Thread.sleep(50)
                        MockResponse()
                            .setResponseCode(200)
                            .setBody("{\"accessToken\":\"new-access\",\"refreshToken\":\"new-refresh\",\"user\":{\"id\":\"u1\",\"email\":\"a@example.com\",\"username\":\"A\"}}")
                    }
                    request.path == "/api/notes/stats" && request.getHeader("Authorization") == "Bearer old-access" -> {
                        MockResponse().setResponseCode(401).setBody("{\"error\":{\"code\":\"unauthorized\"}}")
                    }
                    request.path == "/api/notes/stats" && request.getHeader("Authorization") == "Bearer new-access" -> {
                        MockResponse().setResponseCode(200).setBody("{\"total\":42}")
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()

        try {
            val session = InMemoryTokenStore(accessToken = "old-access", refreshToken = "old-refresh")
            val api = ApiClientFactory.createForTest(server.url("/api/").toString(), session)

            val results = awaitAll(
                async { api.noteStats() },
                async { api.noteStats() }
            )

            assertEquals(listOf(42, 42), results.map { it.total })
            assertEquals(1, refreshCalls.get())
            assertEquals("new-access", session.accessToken())
            assertEquals("new-refresh", session.refreshToken())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun refreshUnauthorizedClearsCredentialsWithoutClearingAccountData() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":{\"code\":\"unauthorized\"}}"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":{\"code\":\"unauthorized\"}}"))
        server.start()

        try {
            val session = RecordingTokenStore()
            val api = ApiClientFactory.createForTest(server.url("/api/").toString(), session)

            runCatching { api.noteStats() }

            // 审计 High H3：refresh 401 只清凭证，绝不走清业务数据的 clear()。
            assertEquals(1, session.clearCredentialsCalls.get())
            assertEquals(0, session.clearAllCalls.get())
            assertNull(session.accessToken())
            assertNull(session.refreshToken())
        } finally {
            server.shutdown()
        }
    }

    private class RecordingTokenStore : TokenStore {
        private var accessToken: String? = "old-access"
        private var refreshToken: String? = "old-refresh"
        val clearCredentialsCalls = AtomicInteger(0)
        val clearAllCalls = AtomicInteger(0)

        override suspend fun accessToken() = accessToken
        override suspend fun refreshToken() = refreshToken
        override suspend fun save(accessToken: String, refreshToken: String?) {
            this.accessToken = accessToken
            this.refreshToken = refreshToken ?: this.refreshToken
        }
        override suspend fun clear() {
            clearAllCalls.incrementAndGet()
            accessToken = null
            refreshToken = null
        }
        override suspend fun clearCredentials() {
            clearCredentialsCalls.incrementAndGet()
            accessToken = null
            refreshToken = null
        }
    }
}
