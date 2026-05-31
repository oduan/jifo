package com.jifo.app.auth

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class LoginViewModelTest {
    @get:Rule val instantTaskExecutorRule = InstantTaskExecutorRule()
    @Test fun rejectsEmptyEmailBeforeCallingRepository() {
        val repo = FakeLoginActions()
        val vm = LoginViewModel(repo)

        vm.submitLogin("", "password123")

        assertEquals("请输入邮箱", vm.state.value!!.error)
        assertEquals(0, repo.loginCalls)
    }
}
