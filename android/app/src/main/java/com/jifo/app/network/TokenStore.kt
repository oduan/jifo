package com.jifo.app.network

interface TokenStore {
    suspend fun accessToken(): String?
    suspend fun refreshToken(): String?
    suspend fun save(accessToken: String, refreshToken: String?)
    suspend fun clear()
}

class InMemoryTokenStore(
    private var accessToken: String?,
    private var refreshToken: String?
) : TokenStore {
    override suspend fun accessToken() = accessToken
    override suspend fun refreshToken() = refreshToken
    override suspend fun save(accessToken: String, refreshToken: String?) {
        this.accessToken = accessToken
        this.refreshToken = refreshToken ?: this.refreshToken
    }
    override suspend fun clear() {
        accessToken = null
        refreshToken = null
    }
}
