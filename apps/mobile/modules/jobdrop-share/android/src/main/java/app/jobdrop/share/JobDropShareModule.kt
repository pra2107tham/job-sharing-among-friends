package app.jobdrop.share

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * The JS-facing surface of the Android capture stack.
 *
 * Everything here is synchronous and cheap. The expensive, unreliable parts —
 * the network, the queue drain — happen in BubbleService and ShareWorker where
 * they can outlive the JS runtime.
 */
class JobDropShareModule : Module() {

  class CredentialsRecord : Record {
    @Field var supabaseUrl: String = ""
    @Field var anonKey: String = ""
    @Field var accessToken: String = ""
    @Field var refreshToken: String = ""
    @Field var expiresAt: Double = 0.0
    @Field var userId: String = ""
  }

  private val context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("JobDropShare")

    Function("canDrawOverlay") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(context)
      } else {
        true
      }
    }

    Function("requestOverlayPermission") {
      // There is no runtime dialog for this one — it is a settings screen the
      // user has to visit. The app walks them there and re-checks on resume.
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("startBubble") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
        throw IllegalStateException("Overlay permission has not been granted")
      }
      val intent = Intent(context, BubbleService::class.java)
      context.startForegroundService(intent)
    }

    Function("stopBubble") {
      context.stopService(Intent(context, BubbleService::class.java))
    }

    Function("isBubbleRunning") {
      // Deliberately not scanning ActivityManager's service list — it is
      // deprecated and unreliable. "Permission granted and not snoozed" is what
      // the UI actually needs to decide what to show.
      val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
      granted && !BubbleService.isSnoozed(context)
    }

    Function("setCredentials") { credentials: CredentialsRecord ->
      ShareStore.saveCredentials(
        context,
        ShareStore.Credentials(
          supabaseUrl = credentials.supabaseUrl,
          anonKey = credentials.anonKey,
          accessToken = credentials.accessToken,
          refreshToken = credentials.refreshToken,
          expiresAt = credentials.expiresAt.toLong(),
          userId = credentials.userId,
        ),
      )
      // A token just arrived, so anything stuck on auth is worth retrying.
      ShareWorker.enqueue(context)
    }

    Function("clearCredentials") {
      ShareStore.clearCredentials(context)
    }

    Function("drainQueue") {
      ShareStore.drain(context).map {
        mapOf(
          "clientShareId" to it.clientShareId,
          "rawInput" to it.rawInput,
          "queuedAt" to it.queuedAt.toDouble(),
          "source" to it.source,
        )
      }
    }

    Function("pendingCount") {
      ShareStore.count(context)
    }

    // The share sheet path. An ACTION_SEND intent reaches the main activity;
    // this captures it into the same queue the bubble uses, so both surfaces
    // converge on one code path.
    OnNewIntent { intent ->
      handleSendIntent(intent)
    }

    OnCreate {
      appContext.currentActivity?.intent?.let { handleSendIntent(it) }
    }
  }

  private fun handleSendIntent(intent: Intent) {
    if (intent.action != Intent.ACTION_SEND) return

    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
      ?: intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.toString()
      ?: return

    if (text.isBlank()) return

    ShareStore.enqueue(context, text.trim(), "share-sheet")
    ShareWorker.enqueue(context)

    // Consume it, so a rotation or a resume does not re-share the same link.
    intent.action = null
    intent.removeExtra(Intent.EXTRA_TEXT)
  }
}
