package com.jifo.app.notes

import android.content.Context
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.TextPaint
import android.text.style.ClickableSpan
import android.view.View
import androidx.core.content.ContextCompat
import com.jifo.app.R
import io.noties.markwon.Markwon
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.image.ImagesPlugin
import io.noties.markwon.image.coil.CoilImagesPlugin

class NoteMarkdownRenderer(context: Context) {
    private val markwon = Markwon.builder(context)
        .usePlugin(StrikethroughPlugin.create())
        .usePlugin(TablePlugin.create(context))
        .usePlugin(ImagesPlugin.create())
        .usePlugin(CoilImagesPlugin.create(context))
        .build()

    fun render(
        context: Context,
        text: String,
        selectedTagPath: String?,
        onTagClick: ((String) -> Unit)?,
        onTaskClick: ((Int) -> Unit)?
    ): CharSequence {
        val rendered = SpannableStringBuilder(markwon.toMarkdown(MarkdownTasks.prepareForRendering(text)))
        NoteTextFormatter.applyTags(context, rendered, selectedTagPath, onTagClick)

        if (onTaskClick != null) {
            var taskIndex = 0
            rendered.forEachIndexed { index, character ->
                if (character != '☐' && character != '☑') return@forEachIndexed
                val currentTask = taskIndex++
                rendered.setSpan(
                    object : ClickableSpan() {
                        override fun onClick(widget: View) = onTaskClick(currentTask)

                        override fun updateDrawState(ds: TextPaint) {
                            ds.color = ContextCompat.getColor(context, R.color.jifo_green)
                            ds.isUnderlineText = false
                            ds.isFakeBoldText = true
                        }
                    },
                    index,
                    index + 1,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
        }
        return rendered
    }
}
