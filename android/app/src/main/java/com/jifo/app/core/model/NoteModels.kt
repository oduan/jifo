package com.jifo.app.core.model

data class NoteContent(val blocks: List<NoteBlock> = emptyList())

data class Note(
    val id: String,
    val clientId: String,
    val blocks: List<NoteBlock>,
    val plainText: String,
    val createdAt: String,
    val updatedAt: String,
    val version: Long,
    val deletedAt: String? = null,
    val syncStatus: SyncStatus = SyncStatus.SYNCED
)

enum class SyncStatus { SYNCED, PENDING, SYNCING, FAILED }
