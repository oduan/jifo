package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface HeatmapDao {
    @Query("SELECT * FROM heatmap_days ORDER BY date ASC") fun observeDays(): Flow<List<HeatmapDayEntity>>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertAll(days: List<HeatmapDayEntity>)
    @Query("DELETE FROM heatmap_days") suspend fun clear()
}
