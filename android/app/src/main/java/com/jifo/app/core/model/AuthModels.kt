package com.jifo.app.core.model

data class User(val id: String, val email: String, val username: String?)
data class AuthSession(val accessToken: String, val refreshToken: String?, val user: User?)
