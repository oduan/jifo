package com.jifo.app

import android.content.Context
import androidx.room.Room
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
import com.jifo.app.notes.NotesRepository
import com.jifo.app.sync.JifoSyncRemote
import com.jifo.app.sync.JifoSyncWorker
import com.jifo.app.sync.SyncCoordinator
import com.jifo.app.sync.SyncScheduler

object ServiceLocator {
    @Volatile private var db: JifoDatabase? = null

    fun database(context: Context): JifoDatabase = db ?: synchronized(this) {
        db ?: Room.databaseBuilder(context.applicationContext, JifoDatabase::class.java, "jifo.db").build().also { db = it }
    }

    fun tokenStore(context: Context): RoomTokenStore = RoomTokenStore(database(context))

    fun api(context: Context): JifoApi = ApiClientFactory.create(BuildConfig.DEFAULT_API_BASE_URL, tokenStore(context))

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
}

class WorkManagerSyncScheduler(context: Context) : SyncScheduler {
    private val appContext = context.applicationContext

    override fun scheduleNow() {
        val request = OneTimeWorkRequestBuilder<JifoSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(appContext).enqueueUniqueWork("jifo-sync", ExistingWorkPolicy.KEEP, request)
    }
}

class RoomTokenStore(private val db: JifoDatabase) : TokenStore, com.jifo.app.auth.SessionStore {
    override suspend fun accessToken(): String? = db.authSessionDao().current()?.accessToken
    override suspend fun refreshToken(): String? = db.authSessionDao().current()?.refreshToken
    override suspend fun save(accessToken: String, refreshToken: String?) {
        val current = db.authSessionDao().current()
        db.authSessionDao().save(AuthSessionEntity(accessToken = accessToken, refreshToken = refreshToken, userJson = current?.userJson, deviceCode = current?.deviceCode ?: "android"))
    }
    override suspend fun clear() = db.authSessionDao().clear()
    override suspend fun current(): com.jifo.app.auth.StoredSession? = db.authSessionDao().current()?.let {
        com.jifo.app.auth.StoredSession(it.accessToken, it.refreshToken, null, null, it.deviceCode)
    }
    override suspend fun deviceCode(): String? = db.authSessionDao().current()?.deviceCode
    override suspend fun save(response: AuthResponse, deviceCode: String) {
        db.authSessionDao().save(AuthSessionEntity(accessToken = response.accessToken, refreshToken = response.refreshToken, userJson = response.user?.email, deviceCode = deviceCode))
    }
}
