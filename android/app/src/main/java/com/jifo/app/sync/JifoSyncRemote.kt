package com.jifo.app.sync

import android.util.Log
import com.jifo.app.network.ApiClientFactory
import com.jifo.app.network.ApiNoteDto
import com.jifo.app.network.JifoApi
import com.jifo.app.network.SyncCursorDto
import com.jifo.app.network.SyncPullResponse
import com.jifo.app.network.SyncPushRequest
import com.jifo.app.network.SyncPushResponse
import com.jifo.app.network.MediaAssetDto
import com.jifo.app.data.local.PendingMediaEntity
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.JsonReader
import com.squareup.moshi.Moshi
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

class JifoSyncRemote(
    private val api: JifoApi,
    // M1: pull 端点返回原始响应体,这里手工逐条容错解析;Moshi 配置与 Retrofit 端一致。
    private val moshi: Moshi = ApiClientFactory.moshi
) : SyncRemote {
    override suspend fun push(body: SyncPushRequest): SyncPushResponse = api.push(body)

    override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse =
        api.pull(updatedAt, id, limit).use { body -> parsePullPage(moshi, body.source()) }

    override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto {
        val body = media.bytes.toRequestBody(media.mimeType.toMediaTypeOrNull())
        val part = MultipartBody.Part.createFormData("file", media.fileName, body)
        return api.uploadMedia(part).item
    }
}

// M1 逐条容错:页面级结构(notes/items 数组、cursor 对象、顶层 JSON 本身)损坏仍抛
// 异常,交由同步整页重试;单条笔记绑定失败(非 null 字段为显式 null、类型不符等)
// 只跳过该条并 Log.w 留痕,不让一页里的一条坏记录打崩整页。
internal fun parsePullPage(moshi: Moshi, source: okio.BufferedSource): SyncPullResponse {
    val noteAdapter = moshi.adapter(ApiNoteDto::class.java)
    val cursorAdapter = moshi.adapter(SyncCursorDto::class.java)
    val notes = mutableListOf<ApiNoteDto>()
    val items = mutableListOf<ApiNoteDto>()
    var cursor: SyncCursorDto? = null
    var nextCursor: SyncCursorDto? = null
    JsonReader.of(source).use { reader ->
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "notes" -> readNotes(reader, noteAdapter, notes)
                "items" -> readNotes(reader, noteAdapter, items)
                "cursor" -> cursor = readCursor(cursorAdapter, reader)
                "nextCursor" -> nextCursor = readCursor(cursorAdapter, reader)
                else -> reader.skipValue()
            }
        }
        reader.endObject()
    }
    return SyncPullResponse(notes = notes, items = items, cursor = cursor, nextCursor = nextCursor)
}

private fun readNotes(reader: JsonReader, adapter: JsonAdapter<ApiNoteDto>, sink: MutableList<ApiNoteDto>) {
    if (reader.peek() != JsonReader.Token.BEGIN_ARRAY) {
        // 字段类型异常(如 "notes": null / 非数组):整段丢弃,当作空列表
        reader.skipValue()
        return
    }
    reader.beginArray()
    while (reader.hasNext()) {
        // readJsonValue 消费整个元素并保持 reader 定位正确,先取原始 JSON 树再单独
        // 绑定:绑定失败只影响这一条,不污染后续条目的解析。
        val raw = reader.readJsonValue() ?: continue
        runCatching { adapter.fromJsonValue(raw) }
            .onFailure { error -> Log.w(TAG, "sync pull: 跳过无法解析的笔记条目: ${error.message}") }
            .getOrNull()
            ?.let { sink += it }
    }
    reader.endArray()
}

private fun readCursor(adapter: JsonAdapter<SyncCursorDto>, reader: JsonReader): SyncCursorDto? {
    val raw = reader.readJsonValue() ?: return null
    return runCatching { adapter.fromJsonValue(raw) }
        .onFailure { error -> Log.w(TAG, "sync pull: 跳过无法解析的 cursor: ${error.message}") }
        .getOrNull()
}

private const val TAG = "JifoSyncRemote"
