package com.jifo.app.settings

import com.jifo.app.network.AccessKeyDto
import com.jifo.app.network.AccessKeyListResponse
import com.jifo.app.network.CreateAccessKeyRequest
import com.jifo.app.network.CreateAccessKeyResponse
import com.jifo.app.network.ChangePasswordRequest

class FakeSettingsApi(private val secret: String = "secret") : SettingsRemote {
    override suspend fun accessKeys(): AccessKeyListResponse = AccessKeyListResponse()
    override suspend fun createAccessKey(body: CreateAccessKeyRequest): CreateAccessKeyResponse = CreateAccessKeyResponse(
        item = AccessKeyDto("key-1", body.label, "jifo_abcd••••", "2026-05-31T00:00:00Z"),
        secret = secret
    )
    override suspend fun deleteAccessKey(id: String) = Unit
    override suspend fun changePassword(body: ChangePasswordRequest) = Unit
    override suspend fun logout() = Unit
}
