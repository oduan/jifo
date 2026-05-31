package com.jifo.app.test

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.jifo.app.data.local.JifoDatabase

object TestDatabaseFactory {
    fun create(): JifoDatabase = Room.inMemoryDatabaseBuilder(
        ApplicationProvider.getApplicationContext(),
        JifoDatabase::class.java
    ).allowMainThreadQueries().build()
}
