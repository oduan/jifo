package com.jifo.app.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.jifo.app.ServiceLocator
import kotlinx.coroutines.CancellationException

class JifoSyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = try {
        ServiceLocator.syncCoordinator(applicationContext).runOnce()
        Result.success()
    } catch (_: SyncAccountChangedException) {
        Result.success()
    } catch (error: CancellationException) {
        throw error
    } catch (_: Throwable) {
        Result.retry()
    }
}
