package com.jifo.app.notes

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import android.widget.ImageView
import androidx.test.core.app.ApplicationProvider
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MediaImageLoaderTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    // 纯色 JPEG 的字节量远小于同尺寸位图,可在单测里低成本构造真实可解码的大图
    private fun jpegBytes(width: Int, height: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.rgb(120, 130, 140))
        val out = ByteArrayOutputStream()
        assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out))
        return out.toByteArray()
    }

    private fun testBitmap(): Bitmap = Bitmap.createBitmap(10, 10, Bitmap.Config.ARGB_8888)

    // ---- calculateInSampleSize:纯函数采样率计算 ----

    @Test
    fun `inSampleSize keeps 1 when image already within max edge`() {
        assertEquals(1, MediaImageLoader.calculateInSampleSize(1000, 500, 2048))
        assertEquals(1, MediaImageLoader.calculateInSampleSize(2048, 2048, 2048))
    }

    @Test
    fun `inSampleSize caps longest edge at max`() {
        // 4000×3000 降一档为 2000×1500
        assertEquals(2, MediaImageLoader.calculateInSampleSize(4000, 3000, 2048))
        // 8000×6000 需要两档
        assertEquals(4, MediaImageLoader.calculateInSampleSize(8000, 6000, 2048))
        // 4097 整除一档后恰为 2048
        assertEquals(2, MediaImageLoader.calculateInSampleSize(4097, 1, 2048))
    }

    @Test
    fun `inSampleSize returns 1 for invalid dimensions`() {
        assertEquals(1, MediaImageLoader.calculateInSampleSize(0, 100, 2048))
        assertEquals(1, MediaImageLoader.calculateInSampleSize(100, 100, 0))
    }

    // ---- decodeSampled:两段式降采样解码 ----

    @Test
    fun `decodeSampled downsamples to max edge`() {
        val bitmap = MediaImageLoader.decodeSampled(jpegBytes(2000, 1000), maxEdge = 500)

        assertNotNull(bitmap)
        assertEquals(500, bitmap!!.width)
        assertEquals(250, bitmap.height)
    }

    @Test
    fun `decodeSampled keeps full size within max edge`() {
        val bitmap = MediaImageLoader.decodeSampled(jpegBytes(1000, 500), maxEdge = 2048)

        assertNotNull(bitmap)
        assertEquals(1000, bitmap!!.width)
        assertEquals(500, bitmap.height)
    }

    @Test
    fun `decodeSampled does not throw for corrupt bytes`() {
        // 真机上无法解析的字节返回 null(bounds 解析失败,outWidth=-1,由 decodeSampled
        // 的 outWidth<=0 守卫兜住);Robolectric 的 BitmapFactory 对解析失败的数据会伪造
        // 位图返回,无法在此断言 null,故只验证不抛异常。
        MediaImageLoader.decodeSampled(byteArrayOf(1, 2, 3), maxEdge = 2048)
    }

    // ---- LruCache:有界缓存与淘汰 ----

    @Test
    fun `lru cache evicts least recently used entries beyond capacity`() {
        // 10×10 ARGB_8888 单张 400 字节,容量 1000 只装得下两张
        MediaImageLoader.rebuildCacheForTest(maxBytes = 1000)
        try {
            MediaImageLoader.cacheBitmap("a", testBitmap())
            MediaImageLoader.cacheBitmap("b", testBitmap())
            MediaImageLoader.cacheBitmap("c", testBitmap())
            // 最先放入的 a 被淘汰
            assertNull(MediaImageLoader.cachedBitmap("a"))
            assertNotNull(MediaImageLoader.cachedBitmap("b"))
            assertNotNull(MediaImageLoader.cachedBitmap("c"))
            // 命中 b 使其变为最近使用,再放 d 时淘汰的是 c 而非 b
            MediaImageLoader.cachedBitmap("b")
            MediaImageLoader.cacheBitmap("d", testBitmap())
            assertNull(MediaImageLoader.cachedBitmap("c"))
            assertNotNull(MediaImageLoader.cachedBitmap("b"))
            assertNotNull(MediaImageLoader.cachedBitmap("d"))
        } finally {
            MediaImageLoader.rebuildCacheForTest()
        }
    }

    @Test
    fun `clearMemoryCache drops all cached bitmaps`() {
        MediaImageLoader.cacheBitmap("k1", testBitmap())
        MediaImageLoader.cacheBitmap("k2", testBitmap())
        assertNotNull(MediaImageLoader.cachedBitmap("k1"))

        MediaImageLoader.clearMemoryCache()

        assertNull(MediaImageLoader.cachedBitmap("k1"))
        assertNull(MediaImageLoader.cachedBitmap("k2"))
    }

    // ---- load/loadLocal 的缓存命中路径(同步返回,不触网不读库) ----

    @Test
    fun `load serves cached bitmap synchronously for media id`() {
        val cached = testBitmap()
        MediaImageLoader.cacheBitmap("m-1", cached)
        val view = ImageView(context)

        MediaImageLoader.load(context, "m-1", view)

        assertSame(cached, (view.drawable as BitmapDrawable).bitmap)
    }

    @Test
    fun `loadLocal serves cached bitmap synchronously for local url`() {
        val cached = testBitmap()
        MediaImageLoader.cacheBitmap(OfflineMediaRepository.localUrl("hit-1"), cached)
        val view = ImageView(context)

        MediaImageLoader.loadLocal(context, OfflineMediaRepository.localUrl("hit-1"), view)

        assertSame(cached, (view.drawable as BitmapDrawable).bitmap)
    }
}
