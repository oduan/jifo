package com.jifo.app.settings

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SettingsViewModelTest {
    @get:Rule val instantTaskExecutorRule = InstantTaskExecutorRule()
    @Test fun createAccessKeyShowsOneTimeSecret() = runTest {
        val vm = SettingsViewModel(SettingsRepository(FakeSettingsApi(secret = "jifo_secret")))
        vm.createAccessKey("Android")
        assertEquals("jifo_secret", vm.state.value!!.createdSecret)
    }
}
