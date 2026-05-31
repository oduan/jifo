package com.jifo.app.sync

import com.jifo.app.network.SyncPullResponse
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import org.junit.Assert.assertEquals
import org.junit.Test

class SyncPullParsingTest {
    @Test fun parsesBackendItemsThatUseNoteIdInsteadOfId() {
        val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
        val adapter = moshi.adapter(SyncPullResponse::class.java)

        val parsed = adapter.fromJson("""
            {
              "items": [
                {
                  "noteId": "11111111-1111-1111-1111-111111111111",
                  "clientId": "web-client-1",
                  "content": {"blocks": [{"type": "paragraph", "text": "from web"}]},
                  "plainText": "from web",
                  "version": 1,
                  "updatedAt": "2026-05-31T11:00:00Z"
                }
              ],
              "notes": [],
              "cursor": null,
              "nextCursor": null
            }
        """.trimIndent())!!

        assertEquals("11111111-1111-1111-1111-111111111111", parsed.items.single().noteId)
        assertEquals("", parsed.items.single().id)
        assertEquals("from web", parsed.items.single().plainText)
    }
}
