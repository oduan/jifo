package com.jifo.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class NoteBlockTest {
    @Test fun plainTextFromBlocksUsesParagraphsDividerAndImageAlt() {
        val blocks = listOf(
            NoteBlock.Paragraph("第一段 #标签"),
            NoteBlock.Divider,
            NoteBlock.Image(mediaId = "media-1", url = null, alt = "截图")
        )

        assertEquals("第一段 #标签\n\n----\n\n截图", blocks.toPlainText())
    }

    @Test fun extractsUniqueTagPaths() {
        val blocks = listOf(NoteBlock.Paragraph("今天 #思考 #产品/移动端 #思考"))

        assertEquals(listOf("思考", "产品/移动端"), blocks.extractTagPaths())
    }
}
