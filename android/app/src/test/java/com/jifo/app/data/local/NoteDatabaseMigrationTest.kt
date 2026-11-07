package com.jifo.app.data.local

import android.content.Context
import androidx.room.Room
import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.test.core.app.ApplicationProvider
import com.jifo.app.ServiceLocator.MIGRATION_3_4
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// L2:用手工 DDL 构造 v3 结构(user_version=3、notes 无索引),再由 Room 走真实
// 升级路径。Room 会在迁移后做 schema 校验——迁移漏建索引、索引名与实体声明不符、
// 或 DDL 与实体定义漂移,open 时直接抛错,而不是静默坏库。
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoteDatabaseMigrationTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dbName = "migration-notes-test.db"
    private lateinit var db: JifoDatabase

    @Before
    fun setUp() = runTest {
        context.deleteDatabase(dbName)
        // v3 schema(升级前):与各实体字段一一对应,notes 尚无任何索引。
        val manual = context.openOrCreateDatabase(dbName, Context.MODE_PRIVATE, null)
        V3_SCHEMA.forEach(manual::execSQL)
        manual.execSQL(
            "INSERT INTO notes (id, clientId, contentJson, plainText, createdAt, updatedAt, version, syncStatus) " +
                "VALUES ('n1', 'c1', '[]', 'hello', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1, 'SYNCED')"
        )
        manual.version = 3
        manual.close()

        db = Room.databaseBuilder(context, JifoDatabase::class.java, dbName)
            .addMigrations(MIGRATION_3_4)
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun tearDown() {
        db.close()
        context.deleteDatabase(dbName)
    }

    @Test
    fun migration3To4CreatesIndexesAndKeepsRows() = runTest {
        // open 即触发迁移 + schema 校验;若迁移没建对索引,这里直接抛。
        assertEquals(1L, db.noteDao().getById("n1")?.version)

        val indexNames = db.openHelper.writableDatabase
            .query(SimpleSQLiteQuery("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notes'"))
            .use { cursor ->
                buildSet { while (cursor.moveToNext()) add(cursor.getString(0)) }
            }
        assertTrue("index_notes_clientId" in indexNames)
        assertTrue("index_notes_deletedAt_createdAt" in indexNames)
    }

    private companion object {
        val V3_SCHEMA = listOf(
            "CREATE TABLE IF NOT EXISTS `notes` (`id` TEXT NOT NULL, `clientId` TEXT NOT NULL, `contentJson` TEXT NOT NULL, `plainText` TEXT NOT NULL, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, `version` INTEGER NOT NULL, `deletedAt` TEXT, `syncStatus` TEXT NOT NULL, `lastError` TEXT, PRIMARY KEY(`id`))",
            "CREATE TABLE IF NOT EXISTS `outbox_operations` (`localSeq` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `opId` TEXT NOT NULL, `entity` TEXT NOT NULL, `action` TEXT NOT NULL, `noteId` TEXT, `clientId` TEXT NOT NULL, `baseVersion` INTEGER NOT NULL, `payloadJson` TEXT NOT NULL, `status` TEXT NOT NULL, `retryCount` INTEGER NOT NULL, `lastError` TEXT, `createdAt` TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS `tags` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `path` TEXT NOT NULL, `parentId` TEXT, `depth` INTEGER NOT NULL, `noteCount` INTEGER NOT NULL, PRIMARY KEY(`id`))",
            "CREATE TABLE IF NOT EXISTS `heatmap_days` (`date` TEXT NOT NULL, `createdCount` INTEGER NOT NULL, `updatedCount` INTEGER NOT NULL, `totalCount` INTEGER NOT NULL, PRIMARY KEY(`date`))",
            "CREATE TABLE IF NOT EXISTS `auth_session` (`id` TEXT NOT NULL, `accessToken` TEXT NOT NULL, `refreshToken` TEXT, `userJson` TEXT, `deviceCode` TEXT NOT NULL, `userId` TEXT, PRIMARY KEY(`id`))",
            "CREATE TABLE IF NOT EXISTS `sync_state` (`key` TEXT NOT NULL, `value` TEXT NOT NULL, PRIMARY KEY(`key`))",
            "CREATE TABLE IF NOT EXISTS `pending_media` (`localId` TEXT NOT NULL, `bytes` BLOB NOT NULL, `mimeType` TEXT NOT NULL, `fileName` TEXT NOT NULL, `createdAt` TEXT NOT NULL, PRIMARY KEY(`localId`))"
        )
    }
}
