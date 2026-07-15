package com.jifo.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_media")
data class PendingMediaEntity(
    @PrimaryKey val localId: String,
    val bytes: ByteArray,
    val mimeType: String,
    val fileName: String,
    val createdAt: String
)
