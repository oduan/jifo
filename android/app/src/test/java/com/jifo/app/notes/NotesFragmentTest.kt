package com.jifo.app.notes

import androidx.fragment.app.testing.launchFragmentInContainer
import com.jifo.app.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotesFragmentTest {
    // 本测试只断言视图结构。onViewCreated 会在 viewLifecycleOwner.lifecycleScope 上启动
    // heatmap/tag/notes/会话四组协程；若照常执行，测试结束后这些协程仍挂在 Room 查询
    // 执行器上，跨 Robolectric shadow 重置触发重查询会抛 "Illegal connection pointer"，
    // 被 kotlinx-coroutines-test 记为全局未捕获异常，打崩下一个 runTest 类（实测打崩了
    // NotesRepositoryTest）。冻结 Main 后这些协程只入队不执行，片段测试期间不再触库。
    private val testMainDispatcher = StandardTestDispatcher()

    @Before
    fun freezeMainDispatcher() {
        Dispatchers.setMain(testMainDispatcher)
    }

    @After
    fun unfreezeMainDispatcher() {
        Dispatchers.resetMain()
    }

    @Test fun topBarHasMenuLogoAndSearchWithoutTitleRow() {
        val scenario = launchFragmentInContainer<NotesFragment>(themeResId = R.style.Theme_Jifo)
        scenario.onFragment { fragment ->
            val view = fragment.requireView()
            assertNotNull(view.findViewById(R.id.button_menu))
            assertNotNull(view.findViewById(R.id.jifo_logo))
            assertNotNull(view.findViewById(R.id.button_search))
            assertNotNull(view.findViewById(R.id.notes_recycler))
            assertNull(view.findViewById(R.id.workspace_title))
        }
    }
}
