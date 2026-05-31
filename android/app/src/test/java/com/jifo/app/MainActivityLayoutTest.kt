package com.jifo.app

import android.content.Context
import android.view.LayoutInflater
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MainActivityLayoutTest {
    @Test fun rootContentFitsSystemWindowsSoTopBarDoesNotOverlapStatusBar() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = LayoutInflater.from(context).inflate(R.layout.activity_main, null)

        assertTrue(root.fitsSystemWindows)
    }
}
