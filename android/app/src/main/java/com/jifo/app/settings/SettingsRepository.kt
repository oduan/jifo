package com.jifo.app.settings

import com.jifo.app.network.AccessKeyDto
import com.jifo.app.network.AccessKeyListResponse
import com.jifo.app.network.CreateAccessKeyRequest
import com.jifo.app.network.CreateAccessKeyResponse
import com.jifo.app.network.JifoApi
import com.jifo.app.network.ChangePasswordRequest

interface SettingsRemote {
    suspend fun accessKeys(): AccessKeyListResponse
    suspend fun createAccessKey(body: CreateAccessKeyRequest): CreateAccessKeyResponse
    suspend fun deleteAccessKey(id: String)
    suspend fun changePassword(body: ChangePasswordRequest)
    suspend fun logout()
}

class JifoSettingsRemote(private val api: JifoApi) : SettingsRemote {
    override suspend fun accessKeys(): AccessKeyListResponse = api.accessKeys()
    override suspend fun createAccessKey(body: CreateAccessKeyRequest): CreateAccessKeyResponse = api.createAccessKey(body)
    override suspend fun deleteAccessKey(id: String) = api.deleteAccessKey(id)
    override suspend fun changePassword(body: ChangePasswordRequest) = api.changePassword(body)
    override suspend fun logout() = api.logout()
}

class SettingsRepository(private val remote: SettingsRemote) {
    suspend fun listAccessKeys(): List<AccessKeyDto> = remote.accessKeys().items
    suspend fun createAccessKey(label: String): CreateAccessKeyResponse = remote.createAccessKey(CreateAccessKeyRequest(label))
    suspend fun deleteAccessKey(id: String) = remote.deleteAccessKey(id)
    suspend fun changePassword(currentPassword: String, newPassword: String) = remote.changePassword(ChangePasswordRequest(currentPassword, newPassword))
    suspend fun logout() = remote.logout()
}
