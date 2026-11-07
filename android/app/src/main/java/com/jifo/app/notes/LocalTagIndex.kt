package com.jifo.app.notes

import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.TagEntity

private val tagPattern = Regex("""#[^\s#]+""")

object LocalTagIndex {
    // 测试观察钩子:同步侧(M6b)把 rebuild 从"逐页/逐结果事务内"收敛为整轮一次,
    // 单测用它统计调用次数;生产路径不设置,行为不变。
    @Volatile
    internal var rebuildObserver: (suspend () -> Unit)? = null

    suspend fun rebuild(db: JifoDatabase) {
        rebuildObserver?.invoke()
        val counts = linkedMapOf<String, Int>()
        db.noteDao().activeNotes().forEach { note ->
            val noteTags = tagPattern.findAll(note.plainText)
                .map { it.value.removePrefix("#").trim('/') }
                .filter { it.isNotBlank() }
                .flatMap { expandPath(it) }
                .toSet()
            noteTags.forEach { path -> counts[path] = (counts[path] ?: 0) + 1 }
        }
        val tags = counts.keys.sortedWith(compareBy<String> { it.count { ch -> ch == '/' } }.thenBy { it })
            .map { path ->
                val parts = path.split('/')
                val parent = parts.dropLast(1).joinToString("/").ifBlank { null }
                TagEntity(
                    id = path,
                    name = parts.last(),
                    path = path,
                    parentId = parent,
                    depth = parts.size - 1,
                    noteCount = counts[path] ?: 0
                )
            }
        db.tagDao().clear()
        if (tags.isNotEmpty()) db.tagDao().upsertAll(tags)
    }

    private fun expandPath(path: String): List<String> {
        val parts = path.split('/').filter { it.isNotBlank() }
        return parts.indices.map { index -> parts.take(index + 1).joinToString("/") }
    }
}
