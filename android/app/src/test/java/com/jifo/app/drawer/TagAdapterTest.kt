package com.jifo.app.drawer

import android.view.View
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import com.jifo.app.data.local.TagEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TagAdapterTest {
    @Test fun hidesCountsAndShowsOnlyRootUntilExpanded() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val parent = FrameLayout(context)
        val adapter = TagAdapter {}
        adapter.submitList(listOf(
            TagEntity(id = "work", name = "work", path = "work", parentId = null, depth = 0, noteCount = 2),
            TagEntity(id = "work/project", name = "project", path = "work/project", parentId = "work", depth = 1, noteCount = 1)
        ))

        assertEquals(1, adapter.itemCount)
        val rootHolder = adapter.onCreateViewHolder(parent, 0)
        adapter.onBindViewHolder(rootHolder, 0)
        assertEquals("work", rootHolder.itemView.findViewById<android.widget.TextView>(com.jifo.app.R.id.text_tag_name).text.toString())
        assertNull(rootHolder.itemView.findViewById<android.widget.TextView>(android.R.id.text1))
        assertEquals(View.VISIBLE, rootHolder.itemView.findViewById<View>(com.jifo.app.R.id.button_expand_tag).visibility)

        rootHolder.itemView.findViewById<View>(com.jifo.app.R.id.button_expand_tag).performClick()
        assertEquals(2, adapter.itemCount)
        val childHolder = adapter.onCreateViewHolder(parent, 0)
        adapter.onBindViewHolder(childHolder, 1)
        assertEquals("project", childHolder.itemView.findViewById<android.widget.TextView>(com.jifo.app.R.id.text_tag_name).text.toString())
    }
}
