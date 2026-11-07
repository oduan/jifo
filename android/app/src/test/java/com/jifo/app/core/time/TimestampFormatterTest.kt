package com.jifo.app.core.time

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.util.TimeZone

class TimestampFormatterTest {
    private val originalTimeZone = TimeZone.getDefault()

    @Before fun useFixedTimeZone() { TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai")) }
    @After fun restoreTimeZone() { TimeZone.setDefault(originalTimeZone) }

    @Test fun formatsUtcInstantInLocalTimeZone() {
        // UTC 10:00 → Asia/Shanghai(+08:00)18:00
        assertEquals("2026-08-04 18:00", formatNoteTimestamp("2026-08-04T10:00:00Z"))
    }

    @Test fun formatsInstantWithNonUtcOffset() {
        // +02:00 10:00 = UTC 08:00 → Asia/Shanghai 16:00
        assertEquals("2026-08-04 16:00", formatNoteTimestamp("2026-08-04T10:00:00+02:00"))
    }

    @Test fun formatsInstantWithFractionalSeconds() {
        assertEquals("2026-08-04 18:00", formatNoteTimestamp("2026-08-04T10:00:00.123Z"))
    }

    @Test fun fallsBackToRawStringWhenUnparseable() {
        assertEquals("not-a-timestamp", formatNoteTimestamp("not-a-timestamp"))
    }

    @Test fun fallsBackToRawStringWhenOffsetMissing() {
        // 旧数据可能缺时区后缀:Instant.parse 失败,按原样显示
        assertEquals("2026-08-04T10:00:00", formatNoteTimestamp("2026-08-04T10:00:00"))
    }
}
