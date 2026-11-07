package com.jifo.app.network

interface TokenStore {
    suspend fun accessToken(): String?
    suspend fun refreshToken(): String?
    suspend fun save(accessToken: String, refreshToken: String?)
    /** 主动退出登录：凭证与本地业务数据全部清空，只允许用户显式登出路径调用。 */
    suspend fun clear()
    /** 凭证失效（如 refresh 返回 401）：只作废登录凭证，不清本地业务数据；调用后 accessToken()/refreshToken() 必须为 null，用户重新登录同一账号后可继续同步。 */
    suspend fun clearCredentials()
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
    // 内存实现没有独立业务数据，两种清空等价。
    override suspend fun clearCredentials() {
        accessToken = null
        refreshToken = null
    }
}
