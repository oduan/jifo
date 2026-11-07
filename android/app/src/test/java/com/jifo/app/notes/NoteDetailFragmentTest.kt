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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.TimeZone

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoteDetailFragmentTest {
    @Before
    fun resetServiceLocatorDatabase() {
        // ServiceLocator.db 是 JVM 级单例,其 Room 连接建立在首个用例的 Robolectric
        // 环境里;后续用例复用它会在已被 shadow 重置的环境里命中失效的连接指针
        // ("Illegal connection pointer")。每个用例重建自己的库;旧连接不 close,
        // close 同样会触碰失效指针,交给环境回收。
        val field = ServiceLocator::class.java.getDeclaredField("db")
        field.isAccessible = true
        field.set(ServiceLocator, null)
    }

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
            // getNote 结果由 Room IO 线程回投主线程;首次建库时查询更慢,单次 idle()
            // 可能在结果上屏前跑完,轮询等待上屏后再断言。
            awaitText(content, "hello world")
            assertTrue(content.text.toString().contains("hello world"))
        }
    }

    private fun awaitText(view: TextView, expected: String) {
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline && !view.text.toString().contains(expected)) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(25)
        }
    }

    @Test
    fun `detail time renders utc timestamp in local timezone`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val note = NoteEntity(
            id = "n-tz",
            clientId = "c-tz",
            contentJson = "[]",
            plainText = "tz",
            createdAt = "2026-08-04T10:00:00Z",
            updatedAt = "2026-08-04T10:00:00Z",
            version = 1
        )
        runBlocking { ServiceLocator.database(context).noteDao().upsert(note) }
        val original = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
        try {
            val args = Bundle().apply { putString("note_id", "n-tz") }
            val scenario = launchFragmentInContainer<NoteDetailFragment>(
                themeResId = R.style.Theme_Jifo,
                fragmentArgs = args
            )
            shadowOf(Looper.getMainLooper()).idle()
            scenario.onFragment { fragment ->
                val time = fragment.requireView().findViewById<TextView>(R.id.text_note_detail_time)
                awaitText(time, "2026-08-04 18:00")
                assertEquals("2026-08-04 18:00", time.text.toString())
            }
        } finally {
            TimeZone.setDefault(original)
            runBlocking { ServiceLocator.database(context).noteDao().deleteById("n-tz") }
        }
    }
}
