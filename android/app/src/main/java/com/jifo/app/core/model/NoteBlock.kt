package com.jifo.app.core.model

sealed class NoteBlock {
    abstract val type: String

    data class Paragraph(val text: String) : NoteBlock() {
        override val type: String = "paragraph"
    }

    data object Divider : NoteBlock() {
        override val type: String = "divider"
    }

    data class Image(
        val mediaId: String? = null,
        val url: String? = null,
        val alt: String? = null
    ) : NoteBlock() {
        override val type: String = "image"
    }
}

private val tagPattern = Regex("""#[^\s#]+""")

fun List<NoteBlock>.toPlainText(): String = mapNotNull { block ->
    when (block) {
        is NoteBlock.Paragraph -> block.text.takeIf { it.isNotBlank() }
        NoteBlock.Divider -> "----"
        is NoteBlock.Image -> block.alt?.takeIf { it.isNotBlank() } ?: block.url?.takeIf { it.isNotBlank() }
    }
}.joinToString("\n\n")

fun List<NoteBlock>.extractTagPaths(): List<String> = asSequence()
    .filterIsInstance<NoteBlock.Paragraph>()
    .flatMap { tagPattern.findAll(it.text).map { match -> match.value.removePrefix("#").trim('/') } }
    .filter { it.isNotBlank() }
    .distinct()
    .toList()
