package com.jifo.app.auth

import com.jifo.app.network.AuthRequest
import com.jifo.app.network.AuthResponse
import com.jifo.app.network.UserDto

class FakeAuthApi : AuthRemote {
    var lastAuthRequest: AuthRequest? = null
    override suspend fun login(body: AuthRequest): AuthResponse {
        lastAuthRequest = body
        return AuthResponse("access-token", "refresh-token", UserDto("u1", body.email, "User"))
    }
    override suspend fun register(body: AuthRequest): AuthResponse = login(body)
}

class InMemorySessionStore : SessionStore {
    private var session: StoredSession? = null
    override suspend fun current(): StoredSession? = session
    override suspend fun deviceCode(): String? = session?.deviceCode
    override suspend fun save(response: AuthResponse, deviceCode: String) {
        session = StoredSession(response.accessToken, response.refreshToken, response.user?.email, response.user?.username, deviceCode)
    }
    override suspend fun clear() { session = null }
}
