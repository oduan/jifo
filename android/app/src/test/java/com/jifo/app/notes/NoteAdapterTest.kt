package com.jifo.app.notes

import android.app.Activity
import android.content.Context
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import androidx.test.core.app.ApplicationProvider
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.databinding.ItemNoteBinding
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoteAdapterTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun noteWithLines(lineCount: Int): NoteEntity {
        val text = (1..lineCount).joinToString("\n") { "line $it" }
        return NoteEntity(
            id = "n-$lineCount",
            clientId = "c-$lineCount",
            contentJson = NoteJson.encodeBlocks(listOf(NoteBlock.Paragraph(text))),
            plainText = text,
            createdAt = "2026-08-04T10:00:00",
            updatedAt = "2026-08-04T10:00:00",
            version = 1
        )
    }

    private fun bindAndSettle(note: NoteEntity, onExpandClick: ((NoteEntity) -> Unit)? = null): ItemNoteBinding {
        val binding = ItemNoteBinding.inflate(LayoutInflater.from(context))
        // 展开按钮的显隐判定只在 onExpandClick 非空时启用（生产环境两个列表页都会传），
        // 这里用空回调占位以覆盖真实路径。
        NoteAdapter.NoteViewHolder(binding).bind(note, null, null, null, null, onExpandClick ?: {})
        val widthSpec = View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY)
        val heightSpec = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        binding.root.measure(widthSpec, heightSpec)
        binding.root.layout(0, 0, binding.root.measuredWidth, binding.root.measuredHeight)
        // View.post 只有在视图 attach 到窗口后才会执行，这里挂到一个真实 Activity 上
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.setContentView(binding.root)
        shadowOf(Looper.getMainLooper()).idle()
        return binding
    }

    @Test
    fun `long note shows expand button`() {
        val binding = bindAndSettle(noteWithLines(20))

        assertEquals(View.VISIBLE, binding.buttonNoteExpand.visibility)
    }

    @Test
    fun `short note hides expand button`() {
        val binding = bindAndSettle(noteWithLines(3))

        assertEquals(View.GONE, binding.buttonNoteExpand.visibility)
    }

    @Test
    fun `clicking expand invokes callback with the note`() {
        var expandedId: String? = null
        val binding = bindAndSettle(noteWithLines(20)) { expandedId = it.id }

        binding.buttonNoteExpand.performClick()

        assertEquals("n-20", expandedId)
    }
}
