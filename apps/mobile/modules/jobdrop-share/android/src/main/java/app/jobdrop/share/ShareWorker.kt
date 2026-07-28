package app.jobdrop.share

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Drains the native queue in the background.
 *
 * This is what makes doc 1's promise true — "a share must never fail". The
 * bubble writes to disk and returns immediately; delivery happens here, and
 * survives the app being killed, the phone being offline, and a reboot.
 *
 * Entries that come back Unauthorized are left in the queue on purpose: JS
 * drains them on next launch, when there is a fresh token and a real error path
 * to show the user.
 */
class ShareWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

  override suspend fun doWork(): Result {
    val pending = ShareStore.peekAll(applicationContext)
    if (pending.isEmpty()) return Result.success()

    var sawRetryable = false

    for (share in pending) {
      when (ShareUploader.upload(applicationContext, share)) {
        is ShareUploader.Result.Sent -> ShareStore.remove(applicationContext, share.clientShareId)

        // Stop at the first network failure rather than grinding the whole
        // queue; shares are worth keeping in order.
        is ShareUploader.Result.Retry -> {
          sawRetryable = true
          break
        }

        // Leave it for JS. Retrying from here cannot help.
        is ShareUploader.Result.Unauthorized -> Unit
      }
    }

    return if (sawRetryable) Result.retry() else Result.success()
  }

  companion object {
    private const val WORK_NAME = "jobdrop-share-upload"

    fun enqueue(context: Context) {
      val request = OneTimeWorkRequestBuilder<ShareWorker>()
        .setConstraints(
          Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
        )
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
        .build()

      // KEEP, not REPLACE: several drops in quick succession should coalesce
      // into one drain rather than restarting the backoff each time.
      WorkManager.getInstance(context)
        .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
    }
  }
}
