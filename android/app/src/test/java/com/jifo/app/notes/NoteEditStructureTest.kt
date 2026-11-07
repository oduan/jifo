package com.jifo.app.notes

import com.jifo.app.core.model.NoteBlock
import com.jifo.app.core.model.toPlainText
import org.junit.Assert.assertEquals
import org.junit.Test

/** (M3)全页编辑器结构保持:渲染只取段落、保存按原顺序重建,Divider/图片原位保留。 */
class NoteEditStructureTest {
    private fun mixedNote(): List<NoteBlock> = listOf(
        NoteBlock.Paragraph("第一段"),
        NoteBlock.Divider,
        NoteBlock.Paragraph("第二段"),
        NoteBlock.Image(mediaId = "m1", url = "https://example.com/a.jpg", alt = "图一"),
        NoteBlock.Paragraph("第三段")
    )

    @Test
    fun `round trip of divider image and paragraphs keeps structure unchanged`() {
        val original = mixedNote()
        val text = NoteEditFragment.editableText(original)

        assertEquals("第一段\n\n第二段\n\n第三段", text)
        assertEquals(original, NoteEditFragment.rebuildBlocks(original, text, emptyList()))
    }

    @Test
    fun `edited paragraphs replace the slots in place and keep divider between them`() {
        val original = listOf(
            NoteBlock.Paragraph("旧一"),
            NoteBlock.Divider,
            NoteBlock.Paragraph("旧二")
        )

        val rebuilt = NoteEditFragment.rebuildBlocks(original, "新一\n\n新二", emptyList())

        assertEquals(
            listOf(NoteBlock.Paragraph("新一"), NoteBlock.Divider, NoteBlock.Paragraph("新二")),
            rebuilt
        )
    }

    @Test
    fun `extra paragraph is inserted after the last original paragraph without moving images`() {
        val image = NoteBlock.Image(mediaId = "m1", url = "https://example.com/a.jpg")
        val original = listOf(
            NoteBlock.Paragraph("一"),
            image,
            NoteBlock.Paragraph("二"),
            NoteBlock.Divider
        )

        val rebuilt = NoteEditFragment.rebuildBlocks(original, "一\n\n二\n\n三", emptyList())

        // 新段落紧跟最后一个段落槽位,Divider/图片相对顺序不变
        assertEquals(
            listOf(
                NoteBlock.Paragraph("一"),
                image,
                NoteBlock.Paragraph("二"),
                NoteBlock.Paragraph("三"),
                NoteBlock.Divider
            ),
            rebuilt
        )
    }

    @Test
    fun `staged image is appended at the tail`() {
        val original = listOf(
            NoteBlock.Paragraph("一"),
            NoteBlock.Image(mediaId = "m1", url = "https://example.com/a.jpg"),
            NoteBlock.Paragraph("二")
        )
        val staged = listOf(NoteBlock.Image(mediaId = "m2", url = "local-media://m2"))

        val rebuilt = NoteEditFragment.rebuildBlocks(original, "一\n\n二", staged)

        assertEquals(original + staged, rebuilt)
    }

    @Test
    fun `blank text degrades to images only like the previous behavior`() {
        val image = NoteBlock.Image(mediaId = "m1", url = "https://example.com/a.jpg")
        val original = listOf(NoteBlock.Paragraph("一"), NoteBlock.Divider, image)
        val staged = listOf(NoteBlock.Image(mediaId = "m2", url = "local-media://m2"))

        assertEquals(listOf(image, staged.single()), NoteEditFragment.rebuildBlocks(original, "", staged))
        assertEquals(listOf(image, staged.single()), NoteEditFragment.rebuildBlocks(original, "   \n\n  ", staged))
    }

    @Test
    fun `originally blank paragraph survives round trip`() {
        val original = listOf(
            NoteBlock.Paragraph("a"),
            NoteBlock.Paragraph(""),
            NoteBlock.Paragraph("b")
        )
        val text = NoteEditFragment.editableText(original)

        assertEquals("a\n\n\n\nb", text)
        assertEquals(original, NoteEditFragment.rebuildBlocks(original, text, emptyList()))
    }

    @Test
    fun `note without paragraph slots puts new text at head like the previous behavior`() {
        val image = NoteBlock.Image(mediaId = "m1", url = "https://example.com/a.jpg", alt = "照片说明")

        // 纯图片笔记进入编辑器时回退渲染 plainText(alt),保存后文本仍在图片之前
        val rebuilt = NoteEditFragment.rebuildBlocks(listOf(image), "照片说明", emptyList())

        assertEquals(listOf(NoteBlock.Paragraph("照片说明"), image), rebuilt)
    }

    @Test
    fun `fewer text chunks than paragraph slots drop the extra paragraphs`() {
        val original = listOf(
            NoteBlock.Paragraph("一"),
            NoteBlock.Paragraph("二"),
            NoteBlock.Paragraph("三")
        )

        val rebuilt = NoteEditFragment.rebuildBlocks(original, "一", emptyList())

        assertEquals(listOf(NoteBlock.Paragraph("一")), rebuilt)
    }

    @Test
    fun `divider-only note saves with pseudo paragraph from plainText fallback keeping divider in place`() {
        // 复刻 NoteEditFragment 加载路径:纯 Divider 笔记无段落可渲染,预填回退到
        // plainText(toPlainText 把 Divider 映射为 "----")。此时文本与段落槽位不对应,
        // 保存按"无槽位、文本置头部"处理:首次保存物化出伪段落,Divider 本体原位保留。
        // 旧实现同病(且旧实现还会把 Divider 整个拍掉);按 ask"退化场景按现有行为"
        // 固化,后续若把无段落笔记的预填改为置空,本用例随之调整。
        val original = listOf(NoteBlock.Divider)
        val editedText = NoteEditFragment.editableText(original).ifBlank { original.toPlainText() }

        assertEquals("----", editedText)
        assertEquals(
            listOf(NoteBlock.Paragraph("----"), NoteBlock.Divider),
            NoteEditFragment.rebuildBlocks(original, editedText, emptyList())
        )
    }
}
