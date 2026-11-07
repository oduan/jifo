package com.jifo.app.sync

import com.jifo.app.network.SyncPullResponse
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// Robolectric:parsePullPage 对脏条目走 Log.w 留痕,android.util.Log 需要 shadow。
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SyncPullParsingTest {
    private fun moshi(): Moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()

    private fun parse(json: String): SyncPullResponse = parsePullPage(moshi(), Buffer().writeUtf8(json))

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

    @Test fun pullPageParsesItemsWithNoteIdInsteadOfId() {
        val parsed = parse("""
            {
              "items": [
                {"noteId": "11111111-1111-1111-1111-111111111111", "clientId": "web-client-1", "version": 1}
              ],
              "notes": []
            }
        """.trimIndent())

        assertEquals("11111111-1111-1111-1111-111111111111", parsed.items.single().noteId)
        assertEquals("", parsed.items.single().id)
    }

    @Test fun pullPageSkipsEntriesWithExplicitNullOnNonNullField() {
        val parsed = parse("""
            {
              "items": [
                {"id": "good-1", "clientId": "c1", "version": 1},
                {"id": "dirty-null-clientId", "clientId": null, "version": 1},
                {"id": "dirty-bad-version", "clientId": "c2", "version": "not-a-long"},
                {"id": "good-2", "clientId": "c3", "version": 1}
              ],
              "notes": [],
              "cursor": {"updatedAt": "2026-06-01T00:00:00Z", "id": "good-2"}
            }
        """.trimIndent())

        assertEquals(listOf("good-1", "good-2"), parsed.items.map { it.id })
        assertEquals("2026-06-01T00:00:00Z", parsed.cursor?.updatedAt)
    }

    @Test fun pullPageDefaultsMissingFieldsAndToleratesNullBlocks() {
        val parsed = parse("""
            {
              "items": [
                {},
                {"id": "scrubbed", "clientId": "c2", "content": {"blocks": null}, "version": 3}
              ],
              "notes": []
            }
        """.trimIndent())

        assertEquals(2, parsed.items.size)
        val empty = parsed.items[0]
        assertEquals("", empty.id)
        assertEquals("", empty.clientId)
        assertEquals(0, empty.version)
        assertNull(parsed.items[1].content?.blocks)
    }

    @Test fun pullPageToleratesNonArrayListsAndUnknownFields() {
        val parsed = parse("""
            {"notes": {"weird": true}, "items": [], "unknownTopLevel": 123}
        """.trimIndent())

        assertEquals(0, parsed.notes.size)
        assertEquals(0, parsed.items.size)
    }

    @Test fun pullPageDropsMalformedCursorButKeepsNotes() {
        val parsed = parse("""
            {
              "items": [{"id": "a", "clientId": "c1", "version": 1}],
              "notes": [],
              "cursor": {"updatedAt": "2026-06-01T00:00:00Z"},
              "nextCursor": "not-an-object"
            }
        """.trimIndent())

        assertEquals(listOf("a"), parsed.items.map { it.id })
        assertEquals("2026-06-01T00:00:00Z", parsed.cursor?.updatedAt)
        assertNull(parsed.nextCursor)
    }
}
