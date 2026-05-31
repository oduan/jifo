package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface NoteDao {
    @Query("""
        SELECT * FROM notes
        WHERE deletedAt IS NULL
          AND (:search IS NULL OR plainText LIKE '%' || :search || '%')
          AND (:tagPath IS NULL OR plainText LIKE '%#' || :tagPath || '%')
        ORDER BY createdAt DESC
        LIMIT :limit
    """)
    fun observeNotes(search: String?, tagPath: String?, limit: Int): Flow<List<NoteEntity>>

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
}
