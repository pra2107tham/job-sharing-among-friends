package app.jobdrop.share

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * The native-side queue and credential store.
 *
 * Encrypted because it holds a Supabase access token: the bubble has to be able
 * to POST while the app is dead, which means the token lives on disk outside
 * the JS runtime's SecureStore.
 *
 * The queue is deliberately dumb — raw text plus an id, nothing parsed. URL
 * canonicalisation and dedupe happen server-side (0016_merge_job_posts.sql)
 * precisely so this file does not have to reimplement doc 1 §8 in Kotlin.
 */
object ShareStore {
  private const val PREFS = "jobdrop_share"
  private const val KEY_QUEUE = "queue"
  private const val KEY_CREDENTIALS = "credentials"

  private fun prefs(context: Context): SharedPreferences {
    val key = MasterKey.Builder(context)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()

    return EncryptedSharedPreferences.create(
      context,
      PREFS,
      key,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  data class Credentials(
    val supabaseUrl: String,
    val anonKey: String,
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: Long,
    val userId: String,
  )

  data class QueuedShare(
    val clientShareId: String,
    val rawInput: String,
    val queuedAt: Long,
    val source: String,
  )

  fun saveCredentials(context: Context, credentials: Credentials) {
    val json = JSONObject().apply {
      put("supabaseUrl", credentials.supabaseUrl)
      put("anonKey", credentials.anonKey)
      put("accessToken", credentials.accessToken)
      put("refreshToken", credentials.refreshToken)
      put("expiresAt", credentials.expiresAt)
      put("userId", credentials.userId)
    }
    prefs(context).edit().putString(KEY_CREDENTIALS, json.toString()).apply()
  }

  fun credentials(context: Context): Credentials? {
    val raw = prefs(context).getString(KEY_CREDENTIALS, null) ?: return null
    return try {
      val json = JSONObject(raw)
      Credentials(
        supabaseUrl = json.getString("supabaseUrl"),
        anonKey = json.getString("anonKey"),
        accessToken = json.getString("accessToken"),
        refreshToken = json.getString("refreshToken"),
        expiresAt = json.optLong("expiresAt", 0L),
        userId = json.optString("userId", ""),
      )
    } catch (_: Exception) {
      null
    }
  }

  fun clearCredentials(context: Context) {
    prefs(context).edit().remove(KEY_CREDENTIALS).apply()
  }

  /** Append and return the generated id, so the caller can report success. */
  fun enqueue(context: Context, rawInput: String, source: String): String {
    val id = UUID.randomUUID().toString()
    val entry = JSONObject().apply {
      put("clientShareId", id)
      put("rawInput", rawInput)
      put("queuedAt", System.currentTimeMillis())
      put("source", source)
    }

    synchronized(this) {
      val array = readArray(context)
      array.put(entry)
      writeArray(context, array)
    }
    return id
  }

  fun peekAll(context: Context): List<QueuedShare> {
    val array = readArray(context)
    val out = mutableListOf<QueuedShare>()
    for (i in 0 until array.length()) {
      val item = array.optJSONObject(i) ?: continue
      out.add(
        QueuedShare(
          clientShareId = item.optString("clientShareId"),
          rawInput = item.optString("rawInput"),
          queuedAt = item.optLong("queuedAt"),
          source = item.optString("source", "bubble"),
        ),
      )
    }
    return out
  }

  /** Remove one entry by id. Used after a successful upload. */
  fun remove(context: Context, clientShareId: String) {
    synchronized(this) {
      val array = readArray(context)
      val kept = JSONArray()
      for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        if (item.optString("clientShareId") != clientShareId) kept.put(item)
      }
      writeArray(context, kept)
    }
  }

  /** Hand everything to JS and empty the queue in one step. */
  fun drain(context: Context): List<QueuedShare> {
    synchronized(this) {
      val all = peekAll(context)
      writeArray(context, JSONArray())
      return all
    }
  }

  fun count(context: Context): Int = readArray(context).length()

  private fun readArray(context: Context): JSONArray {
    val raw = prefs(context).getString(KEY_QUEUE, null) ?: return JSONArray()
    return try {
      JSONArray(raw)
    } catch (_: Exception) {
      // A corrupt queue must not brick sharing forever. Losing queued shares is
      // bad; refusing every future share is worse.
      JSONArray()
    }
  }

  private fun writeArray(context: Context, array: JSONArray) {
    prefs(context).edit().putString(KEY_QUEUE, array.toString()).apply()
  }
}
