package com.jifo.app.notes

import com.jifo.app.data.local.TagEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteTagAutocompleteEngineTest {
    @Test fun findsIndependentHashTriggerOnly() {
        val trigger = NoteTagAutocompleteEngine.findTrigger("记录 #测", "记录 #测".length)

        requireNotNull(trigger)
        assertEquals(3, trigger.hashStart)
        assertEquals("测", trigger.query)

        assertNull(NoteTagAutocompleteEngine.findTrigger("abc#测", "abc#测".length))
        assertNull(NoteTagAutocompleteEngine.findTrigger("#测suffix", 2))
    }

    @Test fun filtersByVisibleTagTextOnly() {
        val tags = listOf(
            tag(id = "id-contains-1", path = "测试"),
            tag(id = "work", path = "工作/前端"),
            tag(id = "test-one", path = "测试1")
        )

        val suggestions = NoteTagAutocompleteEngine.suggestions(tags, "1")

        assertEquals(listOf("测试1"), suggestions.map { it.label })
    }

    @Test fun returnsCreateSuggestionWhenNoMatch() {
        val suggestions = NoteTagAutocompleteEngine.suggestions(listOf(tag(path = "测试")), "新标签")

        assertEquals(1, suggestions.size)
        assertTrue(suggestions.single() is NoteTagSuggestion.Create)
        assertEquals("新标签", suggestions.single().label)
    }

    @Test fun blankQueryShowsExistingTagsButNotCreate() {
        val suggestions = NoteTagAutocompleteEngine.suggestions(listOf(tag(path = "测试")), "")

        assertEquals(listOf("测试"), suggestions.map { it.label })
    }

    private fun tag(id: String = "tag", path: String): TagEntity {
        val parts = path.split('/')
        return TagEntity(
            id = id,
            name = parts.last(),
            path = path,
            parentId = parts.dropLast(1).joinToString("/").ifBlank { null },
            depth = parts.size - 1,
            noteCount = 1
        )
    }
}
