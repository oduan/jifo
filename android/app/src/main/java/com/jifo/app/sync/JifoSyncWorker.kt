package com.jifo.app.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.jifo.app.ServiceLocator

class JifoSyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = try {
        ServiceLocator.syncCoordinator(applicationContext).runOnce()
        Result.success()
    } catch (_: Throwable) {
        Result.retry()
    }
}
