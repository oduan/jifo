package com.jifo.app.sync

import com.jifo.app.network.ApiNoteContent
import org.json.JSONArray
import org.json.JSONObject

object NoteNetworkJson {
    fun encodeContent(content: ApiNoteContent?): String {
        val blocks = JSONArray()
        content?.blocks.orEmpty().forEach { block ->
            blocks.put(JSONObject().put("type", block.type).apply {
                block.text?.let { put("text", it) }
                block.content?.let { put("content", it) }
                block.mediaId?.let { put("mediaId", it) }
                block.url?.let { put("url", it) }
                block.alt?.let { put("alt", it) }
            })
        }
        return blocks.toString()
    }
}
