package com.jifo.app.notes

import com.jifo.app.core.model.NoteBlock
import org.json.JSONArray
import org.json.JSONObject

object NoteJson {
    fun encodeBlocks(blocks: List<NoteBlock>): String = blockArray(blocks).toString()

    fun decodeBlocks(raw: String): List<NoteBlock> = runCatching {
        val array = JSONArray(raw)
        (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            when (item.optString("type")) {
                "paragraph" -> NoteBlock.Paragraph(item.optString("text", item.optString("content")))
                "divider" -> NoteBlock.Divider
                "image" -> NoteBlock.Image(
                    mediaId = item.optString("mediaId").ifBlank { null },
                    url = item.optString("url").ifBlank { null },
                    alt = item.optString("alt").ifBlank { null }
                )
                else -> null
            }
        }
    }.getOrDefault(emptyList())

    fun encodePayload(blocks: List<NoteBlock>, plainText: String): String = JSONObject()
        .put("content", JSONObject().put("blocks", blockArray(blocks)))
        .put("plainText", plainText)
        .toString()

    private fun blockArray(blocks: List<NoteBlock>): JSONArray {
        val array = JSONArray()
        blocks.forEach { block ->
            val item = when (block) {
                is NoteBlock.Paragraph -> JSONObject().put("type", "paragraph").put("text", block.text)
                NoteBlock.Divider -> JSONObject().put("type", "divider")
                is NoteBlock.Image -> JSONObject().put("type", "image").apply {
                    block.mediaId?.let { put("mediaId", it) }
                    block.url?.let { put("url", it) }
                    block.alt?.let { put("alt", it) }
                }
            }
            array.put(item)
        }
        return array
    }
}
