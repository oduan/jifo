package com.jifo.app.auth

import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel

interface LoginActions { fun login(email: String, password: String); fun register(email: String, password: String) }
data class LoginState(val error: String? = null, val loading: Boolean = false)

class LoginViewModel(private val actions: LoginActions) : ViewModel() {
    val state = MutableLiveData(LoginState())
    fun submitLogin(email: String, password: String) {
        if (email.isBlank()) { state.value = state.value!!.copy(error = "请输入邮箱"); return }
        if (password.length < 8) { state.value = state.value!!.copy(error = "密码至少 8 位"); return }
        actions.login(email, password)
    }
}
