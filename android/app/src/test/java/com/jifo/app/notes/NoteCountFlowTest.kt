package com.jifo.app.notes

import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.test.FakeSyncScheduler
import com.jifo.app.test.FixedClock
import com.jifo.app.test.FixedIdGenerator
import com.jifo.app.test.TestDatabaseFactory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** (M6a)抽屉笔记计数:现有 observeNotes Flow 投影成数量,连续相同数量去重。 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoteCountFlowTest {
    private val opened = mutableListOf<JifoDatabase>()

    @After fun tearDown() { opened.forEach { it.close() }; opened.clear() }

    private fun database() = TestDatabaseFactory.create().also { opened += it }

    private fun note(id: String, deletedAt: String? = null) = NoteEntity(
        id = id,
        clientId = id,
        contentJson = "[]",
        plainText = "正文 $id",
        createdAt = "2026-05-31T08:00:00Z",
        updatedAt = "2026-05-31T08:00:00Z",
        version = 1,
        deletedAt = deletedAt,
        syncStatus = "SYNCED"
    )

    @Test fun `projects the notes flow into a count and dedupes unchanged counts`() = runTest {
        val list = listOf(note("a"))

        val counts = NotesFragment.noteCountFlow(
            flowOf(list, list, listOf(note("a"), note("b")))
        ).toList()

        // 列表内容变化但数量不变时只保留一次:不再重复刷新计数文案
        assertEquals(listOf(1, 2), counts)
    }

    @Test fun `count flow reflects active notes from the repository`() = runTest {
        val db = database()
        val repository = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-count-1", "op-1"), FixedClock("2026-05-31T09:00:00Z"))
        db.noteDao().upsert(note("note-1"))
        db.noteDao().upsert(note("note-2"))
        val flow = NotesFragment.noteCountFlow(repository.observeNotes(search = null, tagPath = null, limit = Int.MAX_VALUE))

        assertEquals(2, flow.first())

        // 软删除进入回收站:活跃计数随之减少
        db.noteDao().upsert(note("note-2", deletedAt = "2026-05-31T09:00:00Z"))
        assertEquals(1, flow.first())
    }
}
