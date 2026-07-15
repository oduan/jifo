package com.jifo.app.auth

import com.jifo.app.test.FixedIdGenerator
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthRepositoryTest {
    @Test fun loginSendsAndroidDeviceCodeAndPersistsSession() = runTest {
        val api = FakeAuthApi()
        val store = InMemorySessionStore()
        val repo = AuthRepository(api, store, FixedIdGenerator(deviceCode = "android-device-1"))

        repo.login("user@example.com", "password123")

        assertEquals("android-device-1", api.lastAuthRequest!!.deviceCode)
        assertEquals("access-token", store.current()!!.accessToken)
    }

}
