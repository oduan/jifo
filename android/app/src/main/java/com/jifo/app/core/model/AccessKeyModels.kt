package com.jifo.app.core.model

data class AccessKeySummary(val id: String, val label: String, val maskedKey: String, val createdAt: String, val lastUsedAt: String? = null)
data class CreateAccessKeyResult(val item: AccessKeySummary, val secret: String)
