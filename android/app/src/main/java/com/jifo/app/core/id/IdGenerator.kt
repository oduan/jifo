package com.jifo.app.core.id

import java.util.UUID

interface IdGenerator {
    fun newClientId(prefix: String = "android-note"): String
    fun newOpId(): String
    fun newDeviceCode(prefix: String = "android"): String
}

object UuidIdGenerator : IdGenerator {
    override fun newClientId(prefix: String): String = "$prefix-${UUID.randomUUID()}"
    override fun newOpId(): String = "op-${UUID.randomUUID()}"
    override fun newDeviceCode(prefix: String): String = "$prefix-${UUID.randomUUID()}"
}
