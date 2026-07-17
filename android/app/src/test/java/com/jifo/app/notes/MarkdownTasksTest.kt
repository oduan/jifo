package com.jifo.app.notes

import com.jifo.app.core.model.NoteBlock
import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownTasksTest {
    @Test
    fun `prepares task markers for markdown rendering`() {
        assertEquals("• not a task\n- ☐ todo\n* ☑ done", MarkdownTasks.prepareForRendering("• not a task\n- [ ] todo\n* [X] done"))
    }

    @Test
    fun `toggles the selected task across paragraph blocks`() {
        val blocks = listOf(
            NoteBlock.Paragraph("- [ ] first"),
            NoteBlock.Paragraph("- [x] second\n- [ ] third")
        )

        assertEquals(
            listOf(
                NoteBlock.Paragraph("- [ ] first"),
                NoteBlock.Paragraph("- [ ] second\n- [ ] third")
            ),
            MarkdownTasks.toggle(blocks, 1)
        )
    }
}
