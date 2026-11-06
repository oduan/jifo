package com.jifo.app.sync

import android.content.Context
import android.util.Log
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
    } catch (error: Throwable) {
        // 静默 retry 会让坏数据反复打崩同步且无迹可循，必须留下日志。
        Log.e(TAG, "sync runOnce failed, scheduling retry", error)
        Result.retry()
    }

    private companion object {
        const val TAG = "JifoSync"
    }
}
