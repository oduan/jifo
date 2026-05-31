package com.jifo.app.test

import com.jifo.app.core.id.IdGenerator
import com.jifo.app.core.time.Clock
import com.jifo.app.sync.SyncScheduler

class FakeSyncScheduler : SyncScheduler {
    var calls = 0
    override fun scheduleNow() { calls++ }
}

class FixedClock(private val now: String) : Clock { override fun nowIso(): String = now }

class FixedIdGenerator(private val clientId: String = "client-id", private val opId: String = "op-id", private val deviceCode: String = "device-id") : IdGenerator {
    override fun newClientId(prefix: String): String = clientId
    override fun newOpId(): String = opId
    override fun newDeviceCode(prefix: String): String = deviceCode
}
