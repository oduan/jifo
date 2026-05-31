package com.jifo.app.core.model

data class TagNode(
    val id: String,
    val name: String,
    val path: String,
    val parentId: String? = null,
    val depth: Int = 0,
    val noteCount: Int = 0,
    val children: List<TagNode> = emptyList()
)
