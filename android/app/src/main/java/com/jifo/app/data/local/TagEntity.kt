package com.jifo.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "tags")
data class TagEntity(@PrimaryKey val id: String, val name: String, val path: String, val parentId: String?, val depth: Int, val noteCount: Int)
