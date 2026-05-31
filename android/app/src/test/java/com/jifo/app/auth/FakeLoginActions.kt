package com.jifo.app.auth

class FakeLoginActions : LoginActions {
    var loginCalls = 0
    override fun login(email: String, password: String) { loginCalls++ }
    override fun register(email: String, password: String) = Unit
}
