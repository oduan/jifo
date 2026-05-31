package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface SyncStateDao {
    @Query("SELECT * FROM sync_state WHERE key = :key LIMIT 1") suspend fun get(key: String): SyncStateEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(state: SyncStateEntity)
}
