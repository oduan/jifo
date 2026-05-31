package com.jifo.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "notes")
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
