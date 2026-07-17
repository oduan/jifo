package com.jifo.app.notes

import android.content.Context
import android.text.Spanned
import android.text.style.ClickableSpan
import android.widget.EditText
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoteMarkdownInteractionTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `plain markdown list keeps a bullet span`() {
        val rendered = NoteMarkdownRenderer(context).render(context, "- first\n- second", null, null, null) as Spanned
        val spans = rendered.getSpans(0, rendered.length, Any::class.java)

        assertTrue(spans.any { it.javaClass.simpleName.contains("Bullet", ignoreCase = true) })
    }

    @Test
    fun `second task checkbox invokes second task index`() {
        var clickedIndex = -1
        val rendered = NoteMarkdownRenderer(context).render(
            context,
            "- [ ] first\n- [x] second",
            null,
            null
        ) { clickedIndex = it } as Spanned
        val taskSpans = rendered.getSpans(0, rendered.length, ClickableSpan::class.java)
            .sortedBy { rendered.getSpanStart(it) }

        assertEquals(2, taskSpans.size)
        taskSpans[1].onClick(EditText(context))
        assertEquals(1, clickedIndex)
    }

    @Test
    fun `android editor continues and exits markdown lists`() {
        val editText = EditText(context)
        val autocomplete = NoteTagAutocomplete(editText)
        editText.setText("- first")
        editText.setSelection(editText.length())

        editText.text.insert(editText.selectionStart, "\n")
        assertEquals("- first\n- ", editText.text.toString())

        editText.text.insert(editText.selectionStart, "\n")
        assertEquals("- first\n", editText.text.toString())
        autocomplete.detach()
    }
}
