package com.jifo.app.auth

import com.jifo.app.core.id.IdGenerator
import com.jifo.app.network.AuthRequest
import com.jifo.app.network.AuthResponse
import com.jifo.app.network.JifoApi

interface AuthRemote {
    suspend fun login(body: AuthRequest): AuthResponse
    suspend fun register(body: AuthRequest): AuthResponse
}

class JifoAuthRemote(private val api: JifoApi) : AuthRemote {
    override suspend fun login(body: AuthRequest): AuthResponse = api.login(body)
    override suspend fun register(body: AuthRequest): AuthResponse = api.register(body)
}

data class StoredSession(val accessToken: String, val refreshToken: String?, val userEmail: String?, val username: String?, val deviceCode: String)

interface SessionStore {
    suspend fun current(): StoredSession?
    suspend fun deviceCode(): String?
    suspend fun save(response: AuthResponse, deviceCode: String)
    suspend fun clear()
}

class AuthRepository(
    private val remote: AuthRemote,
    private val sessionStore: SessionStore,
    private val idGenerator: IdGenerator
) {
    suspend fun login(email: String, password: String) {
        val deviceCode = sessionStore.deviceCode() ?: idGenerator.newDeviceCode("android")
        val response = remote.login(AuthRequest(email = email, password = password, deviceCode = deviceCode))
        sessionStore.save(response, deviceCode)
    }

    suspend fun register(email: String, password: String) {
        val deviceCode = sessionStore.deviceCode() ?: idGenerator.newDeviceCode("android")
        val username = email.substringBefore('@').ifBlank { email }
        val response = remote.register(AuthRequest(email = email, password = password, username = username, deviceCode = deviceCode))
        sessionStore.save(response, deviceCode)
    }

    suspend fun logout() = sessionStore.clear()
}
