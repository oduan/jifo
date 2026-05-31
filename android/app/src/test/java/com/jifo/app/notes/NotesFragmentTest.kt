package com.jifo.app.notes

import androidx.fragment.app.testing.launchFragmentInContainer
import com.jifo.app.R
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotesFragmentTest {
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
