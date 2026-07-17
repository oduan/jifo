package com.jifo.app.notes

data class MarkdownListEdit(val text: String, val caret: Int)

object MarkdownListContinuation {
    private val listPattern = Regex("^(\\s*)([-+*]|\\d+[.)])\\s+(?:\\[([ xX])]\\s+)?(.*)$")

    fun apply(text: String, selectionStart: Int, selectionEnd: Int = selectionStart): MarkdownListEdit? {
        val start = minOf(selectionStart, selectionEnd).coerceIn(0, text.length)
        val end = maxOf(selectionStart, selectionEnd).coerceIn(start, text.length)
        val lineStart = text.lastIndexOf('\n', start - 1).let { it + 1 }
        val lineEnd = text.indexOf('\n', end).let { if (it == -1) text.length else it }
        val line = text.substring(lineStart, lineEnd)
        val match = listPattern.matchEntire(line) ?: return null
        val indent = match.groupValues[1]
        val marker = match.groupValues[2]
        val taskState = match.groupValues[3].takeIf { it.isNotEmpty() }
        val content = match.groupValues[4]
        val prefixLength = line.length - content.length

        if (content.isBlank() && start >= lineStart + prefixLength) {
            return MarkdownListEdit(
                text = text.removeRange(lineStart, lineStart + prefixLength),
                caret = lineStart
            )
        }

        val nextMarker = if (marker.firstOrNull()?.isDigit() == true) {
            val delimiter = marker.last()
            "${marker.dropLast(1).toInt() + 1}$delimiter"
        } else {
            marker
        }
        val continuation = "$indent$nextMarker ${if (taskState == null) "" else "[ ] "}"
        return MarkdownListEdit(
            text = text.substring(0, start) + "\n" + continuation + text.substring(end),
            caret = start + 1 + continuation.length
        )
    }
}
