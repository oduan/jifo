package com.jifo.app.notes

import android.content.Context
import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.TextPaint
import android.text.style.ClickableSpan
import android.view.View
import androidx.core.content.ContextCompat
import com.jifo.app.R

object NoteTextFormatter {
    private val tagPattern = Regex("#[^\\s#]+")

    fun format(
        context: Context,
        text: String,
        selectedTagPath: String?,
        onTagClick: ((String) -> Unit)?
    ): CharSequence {
        val matches = tagPattern.findAll(text).toList()
        if (matches.isEmpty()) return text

        val spannable = SpannableString(text)
        val tagTextColor = ContextCompat.getColor(context, R.color.jifo_tag_text)
        val tagBackground = ContextCompat.getColor(context, R.color.jifo_tag_bg)
        val activeBackground = Color.rgb(95, 142, 232)
        val horizontalPadding = dp(context, 5)
        val verticalPadding = dp(context, 1)
        val radius = dp(context, 5).toFloat()

        matches.forEach { match ->
            val start = match.range.first
            val end = match.range.last + 1
            val tagPath = match.value.drop(1)
            val active = selectedTagPath == tagPath
            spannable.setSpan(
                NoteTagSpan(
                    textColor = if (active) Color.WHITE else tagTextColor,
                    backgroundColor = if (active) activeBackground else tagBackground,
                    horizontalPaddingPx = horizontalPadding,
                    verticalPaddingPx = verticalPadding,
                    cornerRadiusPx = radius
                ),
                start,
                end,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
            if (onTagClick != null) {
                spannable.setSpan(
                    object : ClickableSpan() {
                        override fun onClick(widget: View) = onTagClick(tagPath)
                        override fun updateDrawState(ds: TextPaint) {
                            ds.isUnderlineText = false
                            ds.color = if (active) Color.WHITE else tagTextColor
                        }
                    },
                    start,
                    end,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
        }
        return spannable
    }

    private fun dp(context: Context, value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
}
