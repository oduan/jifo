package com.jifo.app.core.time

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// M7: 服务端 createdAt/updatedAt 是 UTC ISO-8601,直接截字符串会把 UTC 时刻当
// 本地时间展示。先解析为 Instant,再按系统默认时区格式化;解析失败(旧数据缺
// 时区后缀、脏数据等)回退原字符串,不让单条坏数据打崩列表或详情页。
private val NOTE_TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

fun formatNoteTimestamp(raw: String): String = runCatching {
    Instant.parse(raw).atZone(ZoneId.systemDefault()).format(NOTE_TIME_FORMAT)
}.getOrDefault(raw)
