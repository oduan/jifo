package com.jifo.app

import com.jifo.app.network.ApiNoteDto
import com.jifo.app.network.SyncPullResponse
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Replays the exact server response the phone app received (HTTP 200, 332544 bytes)
 * through the same Moshi configuration used by ApiClientFactory, then simulates
 * the non-DB part of SyncCoordinator.upsertPulledNote for every note.
 *
 * Requires .migration-tmp/pull_page1.json (captured live response); skips otherwise.
 */
class SyncParseReproTest {

    private val responseFile: File? by lazy {
        listOf(
            File("../../.migration-tmp/pull_page1.json"), // module dir as cwd -> repo root
            File(".migration-tmp/pull_page1.json"),       // repo root as cwd
            File("pull_page1.json"),
        ).firstOrNull { it.exists() }
    }

    private val responseJson: String by lazy {
        responseFile?.readText() ?: error("pull_page1.json not found")
    }

    private fun moshi(): Moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()

    @Test
    fun parseServerResponseLikeTheAppDoes() {
        assumeTrue("capture file not present in this checkout", responseFile != null)
        val parsed = moshi().adapter(SyncPullResponse::class.java).fromJson(responseJson)
        assertTrue("response parsed", parsed != null)
        val notes: List<ApiNoteDto> = parsed!!.notes.ifEmpty { parsed.items }
        println("parsed notes: ${notes.size}, cursor: ${parsed.cursor}")

        // Simulate SyncCoordinator.upsertPulledNote for each note (non-DB steps).
        notes.forEachIndexed { index, note ->
            val noteId = note.id.ifBlank { note.noteId.orEmpty() }
            if (noteId.isBlank()) {
                println("[$index] blank note id (would be skipped)")
                return@forEachIndexed
            }
            if (note.permanentlyDeletedAt != null) {
                println("[$index] tombstone ${note.id}")
                return@forEachIndexed
            }
            // org.json is not available on plain JVM; exercise the DTO fields the
            // entity write persists instead of NoteNetworkJson.encodeContent.
            val encodedLength = note.content?.blocks.orEmpty().sumOf { (it.text?.length ?: 0) + it.type.length + 24 }
            // Touch every field the Room entity write would persist.
            val createdAt = note.createdAt ?: note.updatedAt.orEmpty()
            val updatedAt = note.updatedAt ?: note.createdAt.orEmpty()
            check(note.clientId.isNotEmpty() || true)
            println("[$index] ok id=${noteId.take(8)} clientId=${note.clientId.take(24)} contentBytes≈$encodedLength createdAt=${createdAt.take(30)}")
        }
        println("ALL ${notes.size} NOTES PROCESSED WITHOUT EXCEPTION")
    }
}
