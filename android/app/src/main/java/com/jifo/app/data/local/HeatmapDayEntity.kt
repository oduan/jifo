package com.jifo.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "heatmap_days")
data class HeatmapDayEntity(@PrimaryKey val date: String, val createdCount: Int, val updatedCount: Int, val totalCount: Int)
