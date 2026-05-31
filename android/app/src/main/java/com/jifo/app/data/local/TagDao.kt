package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface TagDao {
    @Query("SELECT * FROM tags ORDER BY depth ASC, name ASC") fun observeTags(): Flow<List<TagEntity>>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertAll(tags: List<TagEntity>)
    @Query("DELETE FROM tags") suspend fun clear()
}
