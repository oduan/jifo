package com.jifo.app.sync

import android.util.Log
import androidx.room.withTransaction
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.data.local.SyncStateEntity
import com.jifo.app.network.ApiNoteDto
import com.jifo.app.network.PushResultDto
import com.jifo.app.notes.LocalTagIndex
import com.jifo.app.notes.OfflineMediaRepository
import com.jifo.app.network.MediaAssetDto
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import retrofit2.HttpException
import java.util.UUID

class SyncCoordinator(
    private val db: JifoDatabase,
    private val remote: SyncRemote
) {
    suspend fun runOnce() {
        val accountId = db.authSessionDao().current()?.userId
        repairPendingCreateMutations(accountId)
        val operations = db.outboxDao().pendingOrFailed()
        for (op in operations) {
            ensureActiveAccount(accountId)
            try {
                pushOperation(op, accountId)
            } catch (error: SyncAccountChangedException) {
                throw error
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                // 单条坏操作只属于它自己:计数、留痕、继续下一条。任何异常都不允许
                // 打断剩余推送,更不允许跳过本轮 pull(审计 H1:一条 400/422 让整轮
                // 同步停摆,后续操作与全部拉取永久卡死)。
                recordPushFailure(op, error)
            }
        }
        // (M6b)push 阶段整轮只重建一次:原来每个 push 结果/404 兜底/rescue 的事务里
        // 各跑一次全表扫描。outbox 为空时本轮 push 不可能改笔记(全部笔记变更都源自
        // operations 循环),连这一次也省掉;即便 push 阶段重建被中断,下方 pull 阶段的
        // 无条件重建会在同一轮内把索引追平。
        if (operations.isNotEmpty()) rebuildTagIndex(accountId)
        pullAllPages(accountId)
    }

    private suspend fun pushOperation(op: OutboxOperationEntity, accountId: String?) {
        try {
            ensureActiveAccount(accountId)
            val prepared = preparePendingMedia(op, accountId)
            val response = remote.push(SyncDtoMapper.toPushRequest(listOf(prepared)))
            response.results.forEach { result -> applyPushResult(result, accountId) }
        } catch (error: HttpException) {
            when (error.code()) {
                404 -> handlePushNotFound(op, accountId)
                // 服务端明确拒绝的请求级错误,重试也不会成功:直接 blocked,
                // pendingOrFailed 不再捞起;其余操作与本轮 pull 照常进行。
                400, 409, 413, 422 -> {
                    val message = "push_rejected_${error.code()}"
                    db.outboxDao().updateStatus(op.opId, "blocked", message)
                    Log.w(TAG, "outbox op ${op.opId} (${op.action}) blocked: $message")
                }
                // 401/403/408/429、5xx 等视为瞬时失败,交由逐 op 隔离处理
                // (401/403 不计入重试上限,见 recordPushFailure)。
                else -> throw error
            }
        }
    }

    /** 记录一次推送失败:鉴权态失败(401/403)不计入重试上限——内容本身没问题,重新登录后必然可推送,计入会把离线编辑永久 block 且重新登录也不复活;其余失败超过重试上限转 blocked(不再捞起),否则置 failed 等待下轮重试。 */
    private suspend fun recordPushFailure(op: OutboxOperationEntity, error: Throwable) {
        if (error is HttpException && (error.code() == 401 || error.code() == 403)) {
            val message = describeFailure(error).take(MAX_LAST_ERROR_LENGTH)
            db.outboxDao().updateStatus(op.opId, "failed", message)
            Log.w(TAG, "outbox op ${op.opId} (${op.action}) failed without retry count: $message")
            return
        }
        recordPushFailure(op.opId, op.retryCount, describeFailure(error))
    }

    private suspend fun recordPushFailure(opId: String, previousRetryCount: Int, message: String) {
        val trimmed = message.take(MAX_LAST_ERROR_LENGTH)
        if (previousRetryCount + 1 > MAX_PUSH_RETRIES) {
            db.outboxDao().updateStatus(opId, "blocked", "retries_exhausted:$trimmed")
        } else {
            db.outboxDao().recordPushFailure(opId, trimmed)
        }
        Log.w(TAG, "outbox op $opId failed: $trimmed")
    }

    private fun describeFailure(error: Throwable): String = when (error) {
        is HttpException -> "push_http_${error.code()}"
        else -> "${error::class.java.simpleName}:${error.message.orEmpty()}"
    }

    private suspend fun preparePendingMedia(original: OutboxOperationEntity, accountId: String?): OutboxOperationEntity {
        if (original.action == "delete") return original
        var current = original
        val root = runCatching { JSONObject(current.payloadJson) }.getOrNull() ?: return current
        val blocks = root.optJSONObject("content")?.optJSONArray("blocks") ?: return current
        val strippedMediaIds = mutableListOf<String>()
        var index = 0
        while (index < blocks.length()) {
            val block = blocks.optJSONObject(index)
            if (block == null || block.optString("type") != "image" || block.optString("mediaId").isNotBlank()) {
                index++
                continue
            }
            val localUrl = block.optString("url")
            val localId = OfflineMediaRepository.localId(localUrl)
            if (localId == null) {
                index++
                continue
            }
            val pending = db.pendingMediaDao().get(localId)
            if (pending == null) {
                // pending 媒体行丢失(换账号清库等)意味着图片已不可恢复:剥离该
                // block、其余内容照常推送并留痕,绝不让一张丢失的图卡死整条操作。
                blocks.remove(index)
                strippedMediaIds += localId
                Log.w(TAG, "pending media $localId missing; stripped from op ${current.opId}")
                continue
            }
            ensureActiveAccount(accountId)
            val asset = remote.uploadMedia(pending)
            block.put("mediaId", asset.id).put("url", asset.url)
            val updatedPayload = root.toString()
            withAccountTransaction(accountId) {
                db.outboxDao().updatePayload(current.opId, updatedPayload)
                val note = current.noteId?.let { db.noteDao().getById(it) } ?: db.noteDao().getByClientId(current.clientId)
                if (note != null) {
                    db.noteDao().upsert(note.copy(contentJson = replaceLocalMedia(note.contentJson, localUrl, asset)))
                }
                db.pendingMediaDao().delete(localId)
            }
            current = current.copy(payloadJson = updatedPayload)
            index++
        }
        if (strippedMediaIds.isNotEmpty()) {
            // 剥离结果落回 op 行,重试/补推不会再次触达缺失媒体;lastError 只作留痕,不改状态。
            val strippedPayload = root.toString()
            withAccountTransaction(accountId) {
                db.outboxDao().updatePayloadJson(current.opId, strippedPayload)
                db.outboxDao().updateStatus(current.opId, current.status, "missing_pending_media:" + strippedMediaIds.joinToString(","))
            }
            current = current.copy(payloadJson = strippedPayload)
        }
        return current
    }

    private fun replaceLocalMedia(contentJson: String, localUrl: String, asset: MediaAssetDto): String {
        val blocks = runCatching { JSONArray(contentJson) }.getOrNull() ?: return contentJson
        for (index in 0 until blocks.length()) {
            val block = blocks.optJSONObject(index) ?: continue
            if (block.optString("type") == "image" && block.optString("url") == localUrl) {
                block.put("mediaId", asset.id).put("url", asset.url)
            }
        }
        return blocks.toString()
    }

    private suspend fun handlePushNotFound(op: OutboxOperationEntity, accountId: String?) {
        when (op.action) {
            "update", "restore" -> rescueMissingRemoteUpdate(op, accountId)
            "delete" -> withAccountTransaction(accountId) {
                db.outboxDao().deleteByOpId(op.opId)
                op.noteId?.let { id -> db.noteDao().getById(id)?.let { note -> db.noteDao().upsert(note.copy(syncStatus = "SYNCED", lastError = null)) } }
            }
            else -> withAccountTransaction(accountId) {
                db.outboxDao().updateStatus(op.opId, "blocked", "note_not_found")
            }
        }
    }

    private suspend fun rescueMissingRemoteUpdate(op: OutboxOperationEntity, accountId: String?) {
        ensureActiveAccount(accountId)
        val local = op.noteId?.let { db.noteDao().getById(it) } ?: db.noteDao().getByClientId(op.clientId)
        if (local == null) {
            withAccountTransaction(accountId) {
                db.outboxDao().updateStatus(op.opId, "blocked", "note_not_found")
            }
            return
        }
        val rescueClientId = "android-note-${UUID.randomUUID()}"
        val rescueOp = OutboxOperationEntity(
            opId = "op-${UUID.randomUUID()}",
            entity = "note",
            action = "create",
            clientId = rescueClientId,
            baseVersion = 0,
            payloadJson = op.payloadJson,
            createdAt = op.createdAt
        )
        withAccountTransaction(accountId) {
            if (local.id != rescueClientId) {
                db.noteDao().deleteById(local.id)
            }
            db.noteDao().upsert(local.copy(id = rescueClientId, clientId = rescueClientId, version = 0, deletedAt = null, syncStatus = "PENDING", lastError = null))
            db.outboxDao().deleteByOpId(op.opId)
            db.outboxDao().insert(rescueOp)
        }
        try {
            pushOperation(rescueOp, accountId)
        } catch (error: SyncAccountChangedException) {
            throw error
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            // 原 op 已在上方删除,失败若按调用方 opId 记账会落空;rescue op 的失败
            // 必须记在它自己名下,否则坏网络下它会绕过重试上限无限重试。
            recordPushFailure(rescueOp, error)
        }
    }

    private suspend fun repairPendingCreateMutations(accountId: String?) {
        val operations = db.outboxDao().pendingOrFailed()
        val invalidLocalMutations = operations.filter { op ->
            op.action in setOf("update", "delete", "restore") && !isUuid(op.noteId)
        }
        if (invalidLocalMutations.isEmpty()) return
        withAccountTransaction(accountId) {
            invalidLocalMutations.forEach { op ->
                val pendingCreate = db.outboxDao().pendingCreateForClient(op.clientId)
                if (pendingCreate != null) {
                    when (op.action) {
                        "update", "restore" -> db.outboxDao().updatePayload(pendingCreate.opId, op.payloadJson)
                        "delete" -> db.outboxDao().deletePendingCreateForClient(op.clientId)
                    }
                    db.outboxDao().deleteByOpId(op.opId)
                } else {
                    db.outboxDao().updateStatus(op.opId, "blocked", "invalid_note_id")
                }
            }
        }
    }

    private fun isUuid(value: String?): Boolean {
        if (value.isNullOrBlank()) return false
        return runCatching { UUID.fromString(value); true }.getOrDefault(false)
    }

    private suspend fun pullAllPages(accountId: String?) {
        ensureActiveAccount(accountId)
        var cursor = db.syncStateDao().get("cursor")
        var parts = cursor?.value?.split('|') ?: emptyList()
        for (page in 0 until MAX_PULL_PAGES) {
            val pull = remote.pull(parts.getOrNull(0), parts.getOrNull(1), 100)
            val notes = if (pull.notes.isNotEmpty()) pull.notes else pull.items
            var nextValue: String? = null
            withAccountTransaction(accountId) {
                // (M6b)逐页事务只负责落库;标签索引重建是 notes 全表扫描,挪到整轮
                // pull 结束后做一次,N 页从 N 次扫描降为 1 次。中途换账号时事务先于
                // 落库抛异常,与原实现一致,不会留下半轮跨账号数据。
                notes.forEach { note -> upsertPulledNote(note) }
                val next = pull.cursor ?: pull.nextCursor
                if (next?.updatedAt != null) {
                    nextValue = next.updatedAt + "|" + (next.id ?: "")
                    db.syncStateDao().put(SyncStateEntity("cursor", nextValue!!))
                }
            }
            if (notes.isEmpty() || nextValue == null || nextValue == cursor?.value) break
            cursor = SyncStateEntity("cursor", nextValue!!)
            parts = nextValue!!.split('|')
        }
        // 无条件重建(与旧实现"每页事务内各跑一次、空页也跑"的自愈语义对齐):即便
        // 本轮没有任何笔记变更、或上一轮在"页已提交、重建未跑"之间被打断(网络异常/
        // 换账号/进程死亡),任意一轮 runOnce 都会把索引追平到当前 notes 表。每轮一次
        // 全表扫描仍远优于旧的每页一次。
        rebuildTagIndex(accountId)
    }

    private suspend fun applyPushResult(result: PushResultDto, accountId: String?) {
        when (result.status) {
            "created", "updated", "deleted", "restored", "duplicate", "already_trashed" -> withAccountTransaction(accountId) {
                val op = db.outboxDao().getByOpId(result.opId)
                if (op != null && result.noteId != null) {
                    val local = db.noteDao().getByClientId(op.clientId)
                    if (local != null) {
                        if (local.id != result.noteId) {
                            db.noteDao().deleteById(local.id)
                        }
                        db.noteDao().upsert(local.copy(id = result.noteId, version = result.version, syncStatus = "SYNCED", lastError = null))
                    }
                }
                db.outboxDao().deleteByOpId(result.opId)
            }
            "conflict_copied" -> withAccountTransaction(accountId) {
                val op = db.outboxDao().getByOpId(result.opId)
                val local = op?.let { db.noteDao().getByClientId(it.clientId) }
                if (local != null) {
                    val conflictId = result.noteId
                    if (!conflictId.isNullOrBlank() && local.id != conflictId) {
                        // Keep the original row pullable so the server version
                        // can replace it, and preserve the local edit under the
                        // conflict note ID until pull supplies canonical data.
                        db.noteDao().upsert(local.copy(syncStatus = "SYNCED", lastError = null))
                        db.noteDao().upsert(local.copy(id = conflictId, clientId = "conflict-local-$conflictId", version = result.version, syncStatus = "SYNCED", lastError = null))
                    } else {
                        db.noteDao().upsert(local.copy(version = result.version, syncStatus = "SYNCED", lastError = null))
                    }
                }
                // The server original may already be behind our incremental
                // cursor because a pending local edit caused an earlier pull
                // to skip it. Force one full reconciliation so the original
                // row is replaced as well as the new conflict copy arriving.
                db.syncStateDao().clear()
                db.outboxDao().deleteByOpId(result.opId)
            }
            "delete_conflict_ignored" -> withAccountTransaction(accountId) {
                val op = db.outboxDao().getByOpId(result.opId)
                val local = op?.let { db.noteDao().getByClientId(it.clientId) }
                if (local != null) {
                    // The server kept a newer active version. Mark this row as
                    // pullable so the immediately following pull can replace
                    // the optimistic local tombstone.
                    db.noteDao().upsert(local.copy(syncStatus = "SYNCED", lastError = null))
                }
                db.syncStateDao().clear()
                db.outboxDao().deleteByOpId(result.opId)
            }
            else -> withAccountTransaction(accountId) {
                // 服务端拒绝(error 结果,如 note_not_found/media_unavailable)与本地
                // 异常同权对待:计入重试上限,超限转 blocked,避免永远重试的僵尸操作。
                val op = db.outboxDao().getByOpId(result.opId)
                if (op != null) recordPushFailure(op.opId, op.retryCount, "push_status:${result.status}")
            }
        }
    }

    private suspend fun ensureActiveAccount(expectedUserId: String?) {
        if (expectedUserId != null && db.authSessionDao().current()?.userId != expectedUserId) {
            throw SyncAccountChangedException()
        }
    }

    /** (M6b)整阶段(push 循环/pull 分页)结束后的唯一重建点:独立小事务里跑,继续沿用账号校验,避免换账号后写入跨账号索引。 */
    private suspend fun rebuildTagIndex(accountId: String?) {
        withAccountTransaction(accountId) { LocalTagIndex.rebuild(db) }
    }

    private suspend fun <T> withAccountTransaction(expectedUserId: String?, block: suspend () -> T): T =
        db.withTransaction {
            ensureActiveAccount(expectedUserId)
            block()
        }

    private suspend fun upsertPulledNote(note: ApiNoteDto) {
        val noteId = note.id.ifBlank { note.noteId.orEmpty() }
        if (noteId.isBlank()) return
        if (note.permanentlyDeletedAt != null) {
            db.outboxDao().deleteForNote(noteId, note.clientId)
            db.noteDao().deleteById(noteId)
            return
        }
        val existing = db.noteDao().getById(noteId)
        if (existing?.syncStatus == "PENDING" || existing?.syncStatus == "SYNCING") return
        db.noteDao().upsert(NoteEntity(
            id = noteId,
            clientId = note.clientId,
            contentJson = NoteNetworkJson.encodeContent(note.content),
            plainText = note.plainText.orEmpty(),
            createdAt = note.createdAt ?: note.updatedAt.orEmpty(),
            updatedAt = note.updatedAt ?: note.createdAt.orEmpty(),
            version = note.version,
            deletedAt = note.deletedAt,
            syncStatus = "SYNCED"
        ))
    }

    private companion object {
        const val TAG = "SyncCoordinator"

        /** 推送失败重试上限:失败超过该次数后操作转 blocked,pendingOrFailed 不再捞起。 */
        const val MAX_PUSH_RETRIES = 8

        /** 单轮 pull 的最大页数(与原 repeat(100) 上限一致)。 */
        const val MAX_PULL_PAGES = 100
        const val MAX_LAST_ERROR_LENGTH = 200
    }
}

class SyncAccountChangedException : IllegalStateException("active account changed during synchronization")
