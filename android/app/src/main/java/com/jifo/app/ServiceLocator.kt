package com.jifo.app

import android.content.Context
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.room.withTransaction
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.Constraints
import androidx.work.WorkManager
import com.jifo.app.auth.AuthRepository
import com.jifo.app.auth.JifoAuthRemote
import com.jifo.app.core.id.UuidIdGenerator
import com.jifo.app.core.time.SystemClock
import com.jifo.app.data.local.AuthSessionEntity
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.network.ApiClientFactory
import com.jifo.app.network.AuthResponse
import com.jifo.app.network.JifoApi
import com.jifo.app.network.TokenStore
import com.jifo.app.notes.MediaImageLoader
import com.jifo.app.notes.NotesRepository
import com.jifo.app.notes.OfflineMediaRepository
import com.jifo.app.settings.JifoSettingsRemote
import com.jifo.app.settings.SettingsRepository
import com.jifo.app.sync.JifoSyncRemote
import com.jifo.app.sync.JifoSyncWorker
import com.jifo.app.sync.SyncCoordinator
import com.jifo.app.sync.SyncScheduler
import org.json.JSONObject
import java.net.URI

object ServiceLocator {
    @Volatile private var db: JifoDatabase? = null
    @Volatile private var apiClient: JifoApi? = null
    @Volatile private var apiClientBaseUrl: String? = null

    private const val CONFIG_PREFERENCES = "jifo.config"
    private const val API_BASE_URL_KEY = "api_base_url"

    fun database(context: Context): JifoDatabase = db ?: synchronized(this) {
        db ?: Room.databaseBuilder(context.applicationContext, JifoDatabase::class.java, "jifo.db")
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
            .build().also { db = it }
    }

    fun tokenStore(context: Context): RoomTokenStore = RoomTokenStore(database(context))

    fun api(context: Context): JifoApi {
        val baseUrl = apiBaseUrl(context)
        val cached = apiClient
        if (cached != null && apiClientBaseUrl == baseUrl) return cached
        return synchronized(this) {
            val synchronizedCached = apiClient
            if (synchronizedCached != null && apiClientBaseUrl == baseUrl) {
                synchronizedCached
            } else {
                ApiClientFactory.create(baseUrl, tokenStore(context)).also {
                    apiClient = it
                    apiClientBaseUrl = baseUrl
                }
            }
        }
    }

    fun apiBaseUrl(context: Context): String {
        val stored = context.applicationContext
            .getSharedPreferences(CONFIG_PREFERENCES, Context.MODE_PRIVATE)
            .getString(API_BASE_URL_KEY, null)
        return runCatching { normalizeApiBaseUrl(stored ?: BuildConfig.DEFAULT_API_BASE_URL) }
            .getOrElse { normalizeApiBaseUrl(BuildConfig.DEFAULT_API_BASE_URL) }
    }

    suspend fun configureApiBaseUrl(context: Context, rawBaseUrl: String) {
        val appContext = context.applicationContext
        val normalized = normalizeApiBaseUrl(rawBaseUrl)
        if (normalized == apiBaseUrl(appContext)) return

        // A database cache belongs to both an account and a server. Changing
        // either boundary must remove credentials, pending mutations and data.
        tokenStore(appContext).clear()
        appContext.getSharedPreferences(CONFIG_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(API_BASE_URL_KEY, normalized)
            .apply()
        synchronized(this) {
            apiClient = null
            apiClientBaseUrl = null
        }
    }

    fun authRepository(context: Context): AuthRepository = AuthRepository(
        JifoAuthRemote(api(context)),
        tokenStore(context),
        UuidIdGenerator
    )

    fun syncScheduler(context: Context): SyncScheduler = WorkManagerSyncScheduler(context.applicationContext)

    fun notesRepository(context: Context): NotesRepository = NotesRepository(
        database(context),
        syncScheduler(context),
        UuidIdGenerator,
        SystemClock
    )

    fun syncCoordinator(context: Context): SyncCoordinator = SyncCoordinator(database(context), JifoSyncRemote(api(context)))

    fun settingsRepository(context: Context): SettingsRepository = SettingsRepository(JifoSettingsRemote(api(context)))

    fun offlineMediaRepository(context: Context): OfflineMediaRepository = OfflineMediaRepository(database(context))

    private val MIGRATION_1_2 = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("CREATE TABLE IF NOT EXISTS `pending_media` (`localId` TEXT NOT NULL, `bytes` BLOB NOT NULL, `mimeType` TEXT NOT NULL, `fileName` TEXT NOT NULL, `createdAt` TEXT NOT NULL, PRIMARY KEY(`localId`))")
        }
    }

    private val MIGRATION_2_3 = object : Migration(2, 3) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE `auth_session` ADD COLUMN `userId` TEXT")
            // Older schemas cannot prove which account owns cached rows. A
            // one-time reset is safer than exposing or replaying another
            // account's data; the active account is repopulated by sync.
            db.execSQL("DELETE FROM `outbox_operations`")
            db.execSQL("DELETE FROM `pending_media`")
            db.execSQL("DELETE FROM `notes`")
            db.execSQL("DELETE FROM `tags`")
            db.execSQL("DELETE FROM `heatmap_days`")
            db.execSQL("DELETE FROM `sync_state`")
        }
    }

    // L2: v3→v4 为 notes 建查询索引,纯 DDL 不搬数据。索引名必须与 Room 的默认
    // 命名约定(index_<table>_<columns>)一致,否则迁移后 schema 校验失败。
    // internal 供迁移测试复用同一份 SQL,避免测试与生产迁移漂移。
    internal val MIGRATION_3_4 = object : Migration(3, 4) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_notes_clientId` ON `notes` (`clientId`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_notes_deletedAt_createdAt` ON `notes` (`deletedAt`, `createdAt`)")
        }
    }

    private fun normalizeApiBaseUrl(raw: String): String {
        val value = raw.trim()
        require(value.isNotEmpty()) { "服务器地址不能为空" }
        val uri = runCatching { URI(value) }.getOrElse { throw IllegalArgumentException("服务器地址格式无效") }
        val allowedScheme = uri.scheme == "https" || (BuildConfig.DEBUG && uri.scheme == "http")
        require(allowedScheme && !uri.host.isNullOrBlank()) {
            if (BuildConfig.DEBUG) "服务器地址必须使用 http 或 https" else "正式版服务器地址必须使用 https"
        }
        require(uri.userInfo == null && uri.query == null && uri.fragment == null) { "服务器地址不能包含账号、查询参数或片段" }
        val path = when (val current = uri.path.orEmpty().trimEnd('/')) {
            "" -> "/api"
            else -> current
        }
        return URI(uri.scheme, null, uri.host, uri.port, "$path/", null, null).toString()
    }
}

class WorkManagerSyncScheduler(context: Context) : SyncScheduler {
    private val appContext = context.applicationContext

    override fun scheduleNow() {
        val request = OneTimeWorkRequestBuilder<JifoSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        // M8: 同步幂等(runOnce 重复执行无害),用 KEEP——调度时若有同步在跑就让它
        // 跑完,不再用 REPLACE 取消进行中的 Worker(跑到一半被杀反而留下中间态)。
        WorkManager.getInstance(appContext).enqueueUniqueWork("jifo-sync", ExistingWorkPolicy.KEEP, request)
    }
}

class RoomTokenStore(private val db: JifoDatabase) : TokenStore, com.jifo.app.auth.SessionStore {
    override suspend fun accessToken(): String? = db.authSessionDao().current()?.accessToken?.takeIf { it.isNotBlank() }
    override suspend fun refreshToken(): String? = db.authSessionDao().current()?.refreshToken
    override suspend fun save(accessToken: String, refreshToken: String?) {
        val current = db.authSessionDao().current()
        db.authSessionDao().save(AuthSessionEntity(accessToken = accessToken, refreshToken = refreshToken ?: current?.refreshToken, userJson = current?.userJson, deviceCode = current?.deviceCode ?: "android", userId = current?.userId))
    }
    override suspend fun clear() {
        db.withTransaction {
            clearAccountData()
            db.authSessionDao().clear()
        }
    }
    // 凭证失效（refresh 401）走这里：只作废 token，保留会话行本身。行内的 userId 是
    // save() 判断「是否换了账号」的唯一依据——若整行删除，用户重新登录同一账号会被
    // 误判为换号而清光本地业务数据，H3 的丢失只是从 401 当下推迟到重新登录时。
    override suspend fun clearCredentials() {
        val current = db.authSessionDao().current() ?: return
        db.authSessionDao().save(current.copy(accessToken = "", refreshToken = null))
    }
    override suspend fun current(): com.jifo.app.auth.StoredSession? = db.authSessionDao().current()
        ?.takeIf { it.accessToken.isNotBlank() }
        ?.let {
            val user = parseUserJson(it.userJson)
            com.jifo.app.auth.StoredSession(it.accessToken, it.refreshToken, user.email, user.username, it.deviceCode, it.userId)
        }
    override suspend fun deviceCode(): String? = db.authSessionDao().current()?.deviceCode
    override suspend fun save(response: AuthResponse, deviceCode: String) {
        val user = requireNotNull(response.user) { "认证响应缺少用户信息" }
        val userJson = JSONObject()
            .put("id", user.id)
            .put("email", user.email)
            .put("username", user.username)
            .toString()
        db.withTransaction {
            val current = db.authSessionDao().current()
            if (current?.userId != user.id) {
                clearAccountData()
            }
            db.authSessionDao().save(AuthSessionEntity(accessToken = response.accessToken, refreshToken = response.refreshToken, userJson = userJson, deviceCode = deviceCode, userId = user.id))
        }
    }

    private suspend fun clearAccountData() {
        MediaImageLoader.clearMemoryCache()
        db.outboxDao().clear()
        db.pendingMediaDao().clear()
        db.noteDao().clear()
        db.tagDao().clear()
        db.heatmapDao().clear()
        db.syncStateDao().clear()
    }

    private fun parseUserJson(raw: String?): ParsedUser = when {
        raw.isNullOrBlank() -> ParsedUser(null, null)
        raw.trim().startsWith("{") -> runCatching {
            val json = JSONObject(raw)
            ParsedUser(json.optString("email").ifBlank { null }, json.optString("username").ifBlank { null })
        }.getOrDefault(ParsedUser(raw, null))
        else -> ParsedUser(raw, raw.substringBefore('@').ifBlank { raw })
    }

    private data class ParsedUser(val email: String?, val username: String?)
}
