package com.jifo.app.notes

import androidx.fragment.app.testing.launchFragmentInContainer
import com.jifo.app.R
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SearchFragmentTest {
    @Test fun searchPageHasSearchInputAndResultsList() {
        val scenario = launchFragmentInContainer<SearchFragment>(themeResId = R.style.Theme_Jifo)
        scenario.onFragment { fragment ->
            val view = fragment.requireView()
            assertNotNull(view.findViewById(R.id.input_search_page))
            assertNotNull(view.findViewById(R.id.search_results_recycler))
            assertNotNull(view.findViewById(R.id.button_back))
        }
    }
}
