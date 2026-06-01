package com.jifo.app.notes

import android.text.Spanned
import android.text.style.ClickableSpan
import android.view.View
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoteTextFormatterTest {
    @Test fun formatsHashtagsWithRoundedTagSpanAndClickHandler() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        var clicked: String? = null

        val formatted = NoteTextFormatter.format(context, "记录 #测试/子标签 内容", selectedTagPath = "测试/子标签") { tag -> clicked = tag }

        assertTrue(formatted is Spanned)
        val spanned = formatted as Spanned
        val tagSpans = spanned.getSpans(0, spanned.length, NoteTagSpan::class.java)
        val clickSpans = spanned.getSpans(0, spanned.length, ClickableSpan::class.java)
        assertEquals(1, tagSpans.size)
        assertEquals(1, clickSpans.size)

        clickSpans.single().onClick(View(context))
        assertEquals("测试/子标签", clicked)
    }
}
