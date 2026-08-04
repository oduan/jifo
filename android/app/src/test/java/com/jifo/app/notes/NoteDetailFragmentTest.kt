package com.jifo.app.notes

import android.content.Context
import android.os.Bundle
import android.os.Looper
import android.widget.TextView
import androidx.fragment.app.testing.launchFragmentInContainer
import androidx.test.core.app.ApplicationProvider
import com.jifo.app.R
import com.jifo.app.ServiceLocator
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.data.local.NoteEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoteDetailFragmentTest {
    @Test
    fun `shows full note content with back button`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val note = NoteEntity(
            id = "n1",
            clientId = "c1",
            contentJson = NoteJson.encodeBlocks(listOf(NoteBlock.Paragraph("hello world"))),
            plainText = "hello world",
            createdAt = "2026-08-04T10:00:00",
            updatedAt = "2026-08-04T10:00:00",
            version = 1
        )
        runBlocking { ServiceLocator.database(context).noteDao().upsert(note) }

        val args = Bundle().apply { putString("note_id", "n1") }
        val scenario = launchFragmentInContainer<NoteDetailFragment>(
            themeResId = R.style.Theme_Jifo,
            fragmentArgs = args
        )
        shadowOf(Looper.getMainLooper()).idle()
        scenario.onFragment { fragment ->
            val view = fragment.requireView()
            assertNotNull(view.findViewById(R.id.button_back))
            val content = view.findViewById<TextView>(R.id.text_note_detail_content)
            assertTrue(content.text.toString().contains("hello world"))
        }
    }
}
