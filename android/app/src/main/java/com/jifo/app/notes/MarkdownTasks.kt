package com.jifo.app.notes

import com.jifo.app.core.model.NoteBlock

object MarkdownTasks {
    private val markerPattern = Regex("(?m)^(\\s*(?:[-+*]|\\d+[.)])\\s+)\\[([ xX])]")

    fun prepareForRendering(text: String): String = markerPattern.replace(text) { match ->
        val marker = if (match.groupValues[2] == " ") "☐" else "☑"
        "${match.groupValues[1]}$marker"
    }

    fun toggle(blocks: List<NoteBlock>, taskIndex: Int): List<NoteBlock> {
        var currentIndex = 0
        return blocks.map { block ->
            if (block !is NoteBlock.Paragraph) return@map block
            val updated = markerPattern.replace(block.text) { match ->
                if (currentIndex++ != taskIndex) {
                    match.value
                } else {
                    val next = if (match.groupValues[2] == " ") "x" else " "
                    "${match.groupValues[1]}[$next]"
                }
            }
            if (updated == block.text) block else NoteBlock.Paragraph(updated)
        }
    }
}
