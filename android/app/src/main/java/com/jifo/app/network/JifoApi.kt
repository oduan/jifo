package com.jifo.app.network

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Multipart
import retrofit2.http.Part
import retrofit2.http.Streaming
import okhttp3.MultipartBody
import okhttp3.ResponseBody

// Auth
data class AuthRequest(val email: String, val password: String, val username: String? = null, val deviceCode: String)
data class RefreshRequest(val refreshToken: String)
data class UserDto(val id: String, val email: String, val username: String?)
data class AuthResponse(val accessToken: String, val refreshToken: String?, val user: UserDto?)

data class NoteStatsDto(val total: Int)

data class ApiNoteBlock(val type: String, val text: String? = null, val content: String? = null, val mediaId: String? = null, val url: String? = null, val alt: String? = null)
data class ApiNoteContent(val blocks: List<ApiNoteBlock> = emptyList())
data class ApiNoteDto(val id: String = "", val noteId: String? = null, val clientId: String, val content: ApiNoteContent? = null, val plainText: String? = null, val deletedAt: String? = null, val createdAt: String? = null, val updatedAt: String? = null, val version: Long = 0)
data class NoteItemResponse(val item: ApiNoteDto)
data class ListNotesPageDto(val limit: Int = 20, val offset: Int = 0, val hasMore: Boolean = false)
data class ListNotesResponse(val items: List<ApiNoteDto> = emptyList(), val page: ListNotesPageDto = ListNotesPageDto())
data class NotePayload(val clientId: String? = null, val content: ApiNoteContent, val plainText: String)

data class TagDto(val id: String, val name: String, val path: String? = null, val parentId: String? = null, val depth: Int = 0, val noteCount: Int = 0, val children: List<TagDto> = emptyList())
data class TagTreeResponse(val items: List<TagDto> = emptyList())
data class HeatmapDayDto(val date: String, val createdCount: Int, val updatedCount: Int, val totalCount: Int)
data class HeatmapResponse(val days: List<HeatmapDayDto> = emptyList())

data class AccessKeyDto(val id: String, val label: String, val maskedKey: String, val createdAt: String, val lastUsedAt: String? = null)
data class AccessKeyListResponse(val items: List<AccessKeyDto> = emptyList())
data class CreateAccessKeyRequest(val label: String)
data class CreateAccessKeyResponse(val item: AccessKeyDto, val secret: String)
data class ChangePasswordRequest(val currentPassword: String, val newPassword: String)
data class RenameTagRequest(val path: String)
data class MediaAssetDto(val id: String, val kind: String, val mimeType: String, val sizeBytes: Long, val checksum: String, val url: String, val createdAt: String)
data class MediaItemResponse(val item: MediaAssetDto)

data class SyncPushRequest(val operations: List<SyncOperationDto>)
data class SyncOperationDto(val opId: String, val entity: String, val action: String, val clientId: String, val noteId: String? = null, val baseVersion: Long, val payload: Map<String, Any?>)
data class SyncPushResponse(val results: List<PushResultDto> = emptyList())
data class PushResultDto(val opId: String, val status: String, val noteId: String? = null, val version: Long = 0)
data class SyncCursorDto(val updatedAt: String? = null, val id: String? = null)
data class SyncPullResponse(val notes: List<ApiNoteDto> = emptyList(), val items: List<ApiNoteDto> = emptyList(), val cursor: SyncCursorDto? = null, val nextCursor: SyncCursorDto? = null)

interface JifoApi {
    @POST("auth/login") suspend fun login(@Body body: AuthRequest): AuthResponse
    @POST("auth/register") suspend fun register(@Body body: AuthRequest): AuthResponse
    @POST("auth/refresh") suspend fun refresh(@Body body: RefreshRequest): AuthResponse

    @GET("notes/stats") suspend fun noteStats(): NoteStatsDto
    @GET("notes") suspend fun listNotes(@Query("search") search: String? = null, @Query("tagPath") tagPath: String? = null, @Query("trash") trash: Boolean = false, @Query("limit") limit: Int = 20, @Query("offset") offset: Int = 0): ListNotesResponse
    @POST("notes") suspend fun createNote(@Body body: NotePayload): NoteItemResponse
    @PATCH("notes/{id}") suspend fun updateNote(@Path("id") id: String, @Body body: NotePayload): NoteItemResponse
    @DELETE("notes/{id}") suspend fun deleteNote(@Path("id") id: String): NoteItemResponse
    @POST("notes/{id}/restore") suspend fun restoreNote(@Path("id") id: String): NoteItemResponse

    @GET("tags/tree") suspend fun tagTree(): TagTreeResponse
    @PATCH("tags/{id}") suspend fun renameTag(@Path("id") id: String, @Body body: RenameTagRequest)
    @DELETE("tags/{id}") suspend fun deleteTag(@Path("id") id: String, @Query("deleteNotes") deleteNotes: Boolean = false)
    @GET("heatmap") suspend fun heatmap(
        @Query("from") from: String,
        @Query("to") to: String,
        @Query("timezone") timezone: String
    ): HeatmapResponse

    @Multipart @POST("media") suspend fun uploadMedia(@Part file: MultipartBody.Part): MediaItemResponse
    @Streaming @GET("media/{id}") suspend fun media(@Path("id") id: String): ResponseBody

    @GET("settings/access-keys") suspend fun accessKeys(): AccessKeyListResponse
    @POST("settings/access-keys") suspend fun createAccessKey(@Body body: CreateAccessKeyRequest): CreateAccessKeyResponse
    @DELETE("settings/access-keys/{id}") suspend fun deleteAccessKey(@Path("id") id: String)
    @POST("me/password") suspend fun changePassword(@Body body: ChangePasswordRequest)
    @POST("auth/logout") suspend fun logout()

    @POST("sync/push") suspend fun push(@Body body: SyncPushRequest): SyncPushResponse
    @GET("sync/pull") suspend fun pull(@Query("updatedAt") updatedAt: String? = null, @Query("id") id: String? = null, @Query("limit") limit: Int = 100): SyncPullResponse
}
