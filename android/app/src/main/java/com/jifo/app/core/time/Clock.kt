package com.jifo.app.core.time

import java.time.Instant

interface Clock { fun nowIso(): String }
object SystemClock : Clock { override fun nowIso(): String = Instant.now().toString() }
