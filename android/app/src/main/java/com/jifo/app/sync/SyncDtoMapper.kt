package com.jifo.app.sync

import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.network.SyncOperationDto
import com.jifo.app.network.SyncPushRequest
import org.json.JSONObject

object SyncDtoMapper {
    fun toPushRequest(operations: List<OutboxOperationEntity>): SyncPushRequest = SyncPushRequest(
        operations.map { op ->
            SyncOperationDto(
                opId = op.opId,
                entity = op.entity,
                action = op.action,
                clientId = op.clientId,
                noteId = op.noteId,
                baseVersion = op.baseVersion,
                payload = jsonObjectToMap(JSONObject(op.payloadJson))
            )
        }
    )

    private fun jsonObjectToMap(json: JSONObject): Map<String, Any?> = json.keys().asSequence().associateWith { key ->
        toPlainJsonValue(json.get(key))
    }

    private fun toPlainJsonValue(value: Any?): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> jsonObjectToMap(value)
        is org.json.JSONArray -> (0 until value.length()).map { index -> toPlainJsonValue(value.get(index)) }
        else -> value
    }
}
