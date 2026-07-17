package com.jifo.app.notes

import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownListContinuationTest {
    @Test
    fun `continues bullet and unchecked task lists`() {
        assertEquals(
            MarkdownListEdit("- first\n- ", 10),
            MarkdownListContinuation.apply("- first", 7)
        )
        assertEquals(
            MarkdownListEdit("- [x] done\n- [ ] ", 17),
            MarkdownListContinuation.apply("- [x] done", 10)
        )
    }

    @Test
    fun `increments ordered lists`() {
        assertEquals(
            MarkdownListEdit("9. item\n10. ", 12),
            MarkdownListContinuation.apply("9. item", 7)
        )
    }

    @Test
    fun `empty generated item exits the list`() {
        assertEquals(
            MarkdownListEdit("- first\n", 8),
            MarkdownListContinuation.apply("- first\n- ", 10)
        )
    }
}
