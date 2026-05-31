package com.jifo.app.settings

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsRepositoryTest {
    @Test fun createAccessKeyReturnsOneTimeSecret() = runTest {
        val repo = SettingsRepository(FakeSettingsApi(secret = "jifo_secret"))

        val result = repo.createAccessKey("Android")

        assertEquals("jifo_secret", result.secret)
    }
}
