package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface NoteDao {
    // L6:搜索词与标签路径里的 % _ \ 必须按字面匹配——先在 SQL 里把参数中的
    // \(自身)、%、_ 依次转义(反斜杠最先转义,避免二次转义),再配合 ESCAPE '\'。
    // 只在 SQL 内转换,调用方(含禁改的 NotesRepository)无需感知。
    @Query("""
        SELECT * FROM notes
        WHERE ((:trash = 0 AND deletedAt IS NULL) OR (:trash = 1 AND deletedAt IS NOT NULL))
          AND (:search IS NULL OR plainText LIKE '%' || replace(replace(replace(:search, '\', '\\'), '%', '\%'), '_', '\_') || '%' ESCAPE '\')
          AND (
              :tagPath IS NULL
              OR (' ' || replace(replace(replace(plainText, char(10), ' '), char(13), ' '), char(9), ' ') || ' ') LIKE '% #' || replace(replace(replace(:tagPath, '\', '\\'), '%', '\%'), '_', '\_') || ' %' ESCAPE '\'
              OR (' ' || replace(replace(replace(plainText, char(10), ' '), char(13), ' '), char(9), ' ') || ' ') LIKE '% #' || replace(replace(replace(:tagPath, '\', '\\'), '%', '\%'), '_', '\_') || '/%' ESCAPE '\'
          )
        ORDER BY createdAt DESC
        LIMIT :limit
    """)
    fun observeNotes(search: String?, tagPath: String?, limit: Int, trash: Boolean = false): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): NoteEntity?

    @Query("SELECT * FROM notes WHERE clientId = :clientId LIMIT 1")
    suspend fun getByClientId(clientId: String): NoteEntity?

    @Query("SELECT * FROM notes WHERE deletedAt IS NULL")
    suspend fun activeNotes(): List<NoteEntity>

    @Query("DELETE FROM notes WHERE id = :id")
    suspend fun deleteById(id: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(note: NoteEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(notes: List<NoteEntity>)

    @Query("DELETE FROM notes")
    suspend fun clear()
}
