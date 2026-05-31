package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface AuthSessionDao {
    @Query("SELECT * FROM auth_session WHERE id = 'current' LIMIT 1") fun observeCurrent(): Flow<AuthSessionEntity?>
    @Query("SELECT * FROM auth_session WHERE id = 'current' LIMIT 1") suspend fun current(): AuthSessionEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun save(session: AuthSessionEntity)
    @Query("DELETE FROM auth_session") suspend fun clear()
}
