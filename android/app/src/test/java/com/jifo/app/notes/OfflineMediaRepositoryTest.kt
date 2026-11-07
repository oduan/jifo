package com.jifo.app.notes

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OfflineMediaRepositoryTest {
    // 纯色 JPEG 的字节量远小于同尺寸位图,可在单测里低成本构造真实可解码的大图
    private fun jpegBytes(width: Int, height: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.rgb(120, 130, 140))
        val out = ByteArrayOutputStream()
        assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out))
        return out.toByteArray()
    }

    @Test
    fun `downscaleForStorage compresses oversized image below max edge`() {
        val original = jpegBytes(2000, 1000)

        // 注入小阈值驱动与生产(MAX_STORED_EDGE=4096)相同的降采样+重编码路径
        val stored = OfflineMediaRepository.downscaleForStorage(original, "image/jpeg", maxEdge = 500)

        assertNotSame(original, stored)
        val decoded = BitmapFactory.decodeByteArray(stored, 0, stored.size)
        assertEquals(500, decoded.width)
        assertEquals(250, decoded.height)
    }

    @Test
    fun `downscaleForStorage keeps bytes unchanged within storage limit`() {
        val original = jpegBytes(1000, 500)

        val stored = OfflineMediaRepository.downscaleForStorage(original, "image/jpeg")

        assertSame(original, stored)
    }

    @Test
    fun `downscaleForStorage leaves unsupported mime untouched`() {
        val original = jpegBytes(2000, 1000)

        val stored = OfflineMediaRepository.downscaleForStorage(original, "image/gif", maxEdge = 500)

        assertSame(original, stored)
    }

    @Test
    fun `downscaleForStorage keeps bytes unchanged for corrupt image`() {
        val original = byteArrayOf(1, 2, 3)

        val stored = OfflineMediaRepository.downscaleForStorage(original, "image/jpeg", maxEdge = 500)

        assertSame(original, stored)
    }
}
