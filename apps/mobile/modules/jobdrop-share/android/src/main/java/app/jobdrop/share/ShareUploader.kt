package app.jobdrop.share

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Posts a queued share straight to the share_job RPC.
 *
 * HttpURLConnection rather than OkHttp: this runs in a foreground service that
 * must start instantly and stay small, and one POST does not justify the
 * dependency.
 *
 * Note what is NOT sent — no canonical_url, no url_hash. The server settles the
 * job's identity during enrichment (0016_merge_job_posts.sql), so the bubble
 * never has to reimplement the URL rules.
 */
object ShareUploader {
  private const val TAG = "JobDropUpload"

  sealed class Result {
    /** Delivered. Drop it from the queue. */
    object Sent : Result()

    /** Worth trying again — offline, 5xx, timeout. */
    object Retry : Result()

    /** Will never succeed as-is: no credentials, or the token was rejected. */
    object Unauthorized : Result()
  }

  fun upload(context: Context, share: ShareStore.QueuedShare): Result {
    val credentials = ShareStore.credentials(context) ?: return Result.Unauthorized

    // A share captured long after the token expired cannot be sent from here.
    // Handing it back to JS is correct: the app can refresh and send it.
    if (credentials.expiresAt in 1..(System.currentTimeMillis() / 1000)) {
      return Result.Unauthorized
    }

    return try {
      val connection =
        (URL("${credentials.supabaseUrl.trimEnd('/')}/rest/v1/rpc/share_job").openConnection()
          as HttpURLConnection)

      connection.apply {
        requestMethod = "POST"
        connectTimeout = 10_000
        readTimeout = 15_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("apikey", credentials.anonKey)
        setRequestProperty("Authorization", "Bearer ${credentials.accessToken}")
        // The RPC returns a row set we do not need; ask for nothing back.
        setRequestProperty("Prefer", "return=minimal")
      }

      val body = JSONObject().apply {
        put("p_client_share_id", share.clientShareId)
        put("p_source_type", "link")
        put("p_raw_input", share.rawInput)
      }

      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

      val code = connection.responseCode
      connection.disconnect()

      when {
        code in 200..299 -> Result.Sent
        code == 401 || code == 403 -> Result.Unauthorized
        // 4xx other than auth means the request itself is wrong; retrying an
        // identical request cannot fix it, so hand it to JS to deal with.
        code in 400..499 -> Result.Unauthorized
        else -> Result.Retry
      }
    } catch (e: Exception) {
      Log.w(TAG, "upload failed, will retry", e)
      Result.Retry
    }
  }
}
