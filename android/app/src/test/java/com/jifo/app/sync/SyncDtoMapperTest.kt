package com.jifo.app.sync

import com.jifo.app.data.local.OutboxOperationEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SyncDtoMapperTest {
    @Test fun convertsNestedJsonPayloadToPlainMapsAndLists() {
        val request = SyncDtoMapper.toPushRequest(listOf(
            OutboxOperationEntity(
                opId = "op-1",
                entity = "note",
                action = "create",
                clientId = "client-1",
                baseVersion = 0,
                payloadJson = """{"content":{"blocks":[{"type":"paragraph","text":"hello"}]},"plainText":"hello"}""",
                createdAt = "2026-05-31T00:00:00Z"
            )
        ))

        val payload = request.operations.single().payload
        assertEquals("hello", payload["plainText"])
        assertTrue(payload["content"] is Map<*, *>)
        val content = payload["content"] as Map<*, *>
        assertTrue(content["blocks"] is List<*>)
        val block = (content["blocks"] as List<*>).single() as Map<*, *>
        assertEquals("paragraph", block["type"])
        assertEquals("hello", block["text"])
    }
}
