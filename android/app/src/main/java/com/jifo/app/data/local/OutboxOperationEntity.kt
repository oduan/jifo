package com.jifo.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "outbox_operations")
data class OutboxOperationEntity(
    @PrimaryKey(autoGenerate = true) val localSeq: Long = 0,
    val opId: String,
    val entity: String,
    val action: String,
    val noteId: String? = null,
    val clientId: String,
    val baseVersion: Long,
    val payloadJson: String,
    val status: String = "pending",
    val retryCount: Int = 0,
    val lastError: String? = null,
    val createdAt: String
)
