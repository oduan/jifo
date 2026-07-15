package com.jifo.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        NoteEntity::class,
        OutboxOperationEntity::class,
        TagEntity::class,
        HeatmapDayEntity::class,
        AuthSessionEntity::class,
        SyncStateEntity::class,
        PendingMediaEntity::class
    ],
    version = 2,
    exportSchema = false
)
abstract class JifoDatabase : RoomDatabase() {
    abstract fun noteDao(): NoteDao
    abstract fun outboxDao(): OutboxDao
    abstract fun tagDao(): TagDao
    abstract fun heatmapDao(): HeatmapDao
    abstract fun authSessionDao(): AuthSessionDao
    abstract fun syncStateDao(): SyncStateDao
    abstract fun pendingMediaDao(): PendingMediaDao
}
