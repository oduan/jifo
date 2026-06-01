package com.jifo.app.notes

import android.graphics.Canvas
import android.graphics.Paint
import android.text.style.ReplacementSpan
import kotlin.math.roundToInt

class NoteTagSpan(
    private val textColor: Int,
    private val backgroundColor: Int,
    private val horizontalPaddingPx: Int,
    private val verticalPaddingPx: Int,
    private val cornerRadiusPx: Float
) : ReplacementSpan() {
    override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
        val width = paint.measureText(text, start, end).roundToInt()
        if (fm != null) {
            val metrics = paint.fontMetricsInt
            fm.ascent = metrics.ascent - verticalPaddingPx
            fm.descent = metrics.descent + verticalPaddingPx
            fm.top = metrics.top - verticalPaddingPx
            fm.bottom = metrics.bottom + verticalPaddingPx
        }
        return width + horizontalPaddingPx * 2
    }

    override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
        val oldColor = paint.color
        val oldStyle = paint.style
        val width = paint.measureText(text, start, end)
        val bgTop = y + paint.fontMetrics.ascent - verticalPaddingPx
        val bgBottom = y + paint.fontMetrics.descent + verticalPaddingPx
        paint.color = backgroundColor
        paint.style = Paint.Style.FILL
        canvas.drawRoundRect(
            x,
            bgTop,
            x + width + horizontalPaddingPx * 2,
            bgBottom,
            cornerRadiusPx,
            cornerRadiusPx,
            paint
        )
        paint.color = textColor
        paint.style = oldStyle
        canvas.drawText(text, start, end, x + horizontalPaddingPx, y.toFloat(), paint)
        paint.color = oldColor
        paint.style = oldStyle
    }
}
