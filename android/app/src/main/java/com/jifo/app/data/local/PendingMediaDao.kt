package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface PendingMediaDao {
    @Query("SELECT * FROM pending_media WHERE localId = :localId LIMIT 1")
    suspend fun get(localId: String): PendingMediaEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(media: PendingMediaEntity)

    @Query("DELETE FROM pending_media WHERE localId = :localId")
    suspend fun delete(localId: String)
}
