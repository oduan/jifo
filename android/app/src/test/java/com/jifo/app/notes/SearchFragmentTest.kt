package com.jifo.app.notes

import android.content.Context
import android.os.Looper
import android.widget.EditText
import androidx.fragment.app.testing.launchFragmentInContainer
import androidx.recyclerview.widget.RecyclerView
import androidx.test.core.app.ApplicationProvider
import com.jifo.app.R
import com.jifo.app.ServiceLocator
import com.jifo.app.data.local.NoteEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@OptIn(ExperimentalCoroutinesApi::class)
class SearchFragmentTest {
    // 与 NotesFragmentTest 同型防护：本测试只断言视图结构，冻结 Main 让片段内
    // lifecycleScope 上的协程只入队不执行，避免测试结束后残留的 Room 查询跨
    // Robolectric shadow 重置抛 "Illegal connection pointer" 污染全局未捕获异常列表。
    private val testMainDispatcher = StandardTestDispatcher()
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Before
    fun freezeMainDispatcher() {
        Dispatchers.setMain(testMainDispatcher)
        // ServiceLocator.db 是 JVM 级单例,其 Room 连接建立在首个用例的 Robolectric
        // 环境里;后续用例复用它会在已被 shadow 重置的环境里命中失效的连接指针
        // ("Illegal connection pointer")。执行 SQL 的用例先重建自己的库;旧连接不
        // close,close 同样会触碰失效指针,交给环境回收。
        val field = ServiceLocator::class.java.getDeclaredField("db")
        field.isAccessible = true
        field.set(ServiceLocator, null)
    }

    @After
    fun unfreezeMainDispatcher() {
        Dispatchers.resetMain()
    }

    @Test fun searchPageHasSearchInputAndResultsList() {
        val scenario = launchFragmentInContainer<SearchFragment>(themeResId = R.style.Theme_Jifo)
        scenario.onFragment { fragment ->
            val view = fragment.requireView()
            assertNotNull(view.findViewById(R.id.input_search_page))
            assertNotNull(view.findViewById(R.id.search_results_recycler))
            assertNotNull(view.findViewById(R.id.button_back))
        }
    }

    // L7: 防抖窗口内的击键不得触发查询;窗口过后才发出一次查询并上屏首帧结果。
    // Room 查询跑在真实执行器线程上,结果上屏用轮询等待,超时按断言失败报告。
    @Test fun typingDebouncesSearchBeforeQuerying() {
        runBlocking {
            ServiceLocator.database(context).noteDao().upsert(
                NoteEntity(
                    id = "debounce-target",
                    clientId = "debounce-client",
                    contentJson = "[]",
                    plainText = "debounce needle",
                    createdAt = "2026-01-01T00:00:00Z",
                    updatedAt = "2026-01-01T00:00:00Z",
                    version = 1
                )
            )
        }
        try {
            val scenario = launchFragmentInContainer<SearchFragment>(themeResId = R.style.Theme_Jifo)
            var adapter: NoteAdapter? = null
            scenario.onFragment { fragment ->
                val view = fragment.requireView()
                view.findViewById<EditText>(R.id.input_search_page).setText("debounce")
                adapter = view.findViewById<RecyclerView>(R.id.search_results_recycler).adapter as? NoteAdapter
            }

            // 防抖窗口内:查询未发出,结果列表为空
            testMainDispatcher.scheduler.advanceTimeBy(SearchFragment.SEARCH_DEBOUNCE_MS - 50)
            testMainDispatcher.scheduler.runCurrent()
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(0, adapter?.itemCount)

            // 越过防抖窗口:查询发出,等待 Room 首帧结果
            testMainDispatcher.scheduler.advanceTimeBy(SearchFragment.SEARCH_DEBOUNCE_MS)
            testMainDispatcher.scheduler.runCurrent()
            awaitItemCount(adapter, 1)
        } finally {
            testMainDispatcher.scheduler.runCurrent()
            shadowOf(Looper.getMainLooper()).idle()
            runBlocking { ServiceLocator.database(context).noteDao().deleteById("debounce-target") }
        }
    }

    private fun awaitItemCount(adapter: NoteAdapter?, expected: Int) {
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            testMainDispatcher.scheduler.runCurrent()
            if (adapter?.itemCount == expected) return
            Thread.sleep(25)
        }
        assertEquals(expected, adapter?.itemCount)
    }
}
