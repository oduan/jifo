package com.jifo.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "auth_session")
data class AuthSessionEntity(@PrimaryKey val id: String = "current", val accessToken: String, val refreshToken: String?, val userJson: String?, val deviceCode: String)
