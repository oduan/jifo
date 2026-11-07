package com.jifo.app.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

// L2: clientId 是同步链路 getByClientId 的查询键;deletedAt+createdAt 覆盖
// 列表页"回收站过滤 + createdAt 排序"的查询路径。
@Entity(
    tableName = "notes",
    indices = [
        Index(value = ["clientId"]),
        Index(value = ["deletedAt", "createdAt"])
    ]
)
data class NoteEntity(
    @PrimaryKey val id: String,
    val clientId: String,
    val contentJson: String,
    val plainText: String,
    val createdAt: String,
    val updatedAt: String,
    val version: Long,
    val deletedAt: String? = null,
    val syncStatus: String = "SYNCED",
    val lastError: String? = null
)
