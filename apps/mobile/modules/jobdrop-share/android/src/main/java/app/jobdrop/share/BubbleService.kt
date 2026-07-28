package app.jobdrop.share

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Vibrator
import android.os.VibratorManager
import android.os.VibrationEffect
import android.view.DragEvent
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import app.jobdrop.share.R as ShareR
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The floating bubble (doc 1 §4.2).
 *
 * A foreground service holding SYSTEM_ALERT_WINDOW and inflating a view through
 * WindowManager. This is plain Android views on purpose, not React in the
 * overlay: it has to appear instantly, work when the app process is dead, and
 * send without booting a JS runtime. Doc 1 §4.3 budgets 300ms for the whole
 * gesture and a React context costs more than that on its own.
 *
 * Three ways in, in order of how well they work:
 *
 *  1. DRAG a link onto it. Cross-app drag and drop delivers a real ClipData and
 *     is the only path with no platform caveats. This is the gesture the
 *     product was designed around.
 *  2. TAP to send the clipboard. Best-effort: since Android 10 an app may only
 *     read the clipboard while it holds focus, so the bubble briefly takes
 *     focus to try. When the platform refuses we open the app rather than
 *     failing silently.
 *  3. LONG-PRESS opens the app's composer with nothing assumed.
 *
 * Dragging the bubble to the bottom of the screen hides it for four hours. A
 * bubble the user cannot get rid of gets the app uninstalled.
 */
class BubbleService : android.app.Service() {

  private lateinit var windowManager: WindowManager
  private var bubble: View? = null
  private var dismissZone: View? = null
  private lateinit var params: WindowManager.LayoutParams

  private val handler = Handler(Looper.getMainLooper())
  private val dimRunnable = Runnable { bubble?.animate()?.alpha(IDLE_ALPHA)?.setDuration(200)?.start() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    startForegroundNotification()
    showBubble()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    // START_STICKY so the OEM task killers common on MIUI/ColorOS at least get
    // a chance to bring it back.
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(dimRunnable)
    bubble?.let { runCatching { windowManager.removeView(it) } }
    dismissZone?.let { runCatching { windowManager.removeView(it) } }
    bubble = null
    dismissZone = null
    super.onDestroy()
  }

  // ------------------------------------------------------------- notification

  private fun startForegroundNotification() {
    val channelId = "jobdrop-bubble"
    val manager = getSystemService(NotificationManager::class.java)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // IMPORTANCE_MIN so it sits silently in the shade rather than nagging.
      val channel = NotificationChannel(channelId, "JobDrop bubble", NotificationManager.IMPORTANCE_MIN)
      channel.description = "Keeps the floating share bubble available"
      manager.createNotificationChannel(channel)
    }

    val stopIntent = PendingIntent.getService(
      this,
      0,
      Intent(this, BubbleService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    val notification: Notification = Notification.Builder(this, channelId)
      .setContentTitle("JobDrop bubble is on")
      .setContentText("Drag a job link onto it to share with your groups")
      .setSmallIcon(android.R.drawable.ic_menu_share)
      .addAction(Notification.Action.Builder(null, "Turn off", stopIntent).build())
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  // ------------------------------------------------------------------- bubble

  private fun showBubble() {
    val view = FrameLayout.inflate(this, ShareR.layout.jobdrop_bubble, null)

    params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_PHONE
      },
      // NOT_FOCUSABLE keeps the keyboard and the app underneath behaving
      // normally. We flip it off only for the moment we need the clipboard.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      val saved = loadPosition()
      x = saved.first
      y = saved.second
    }

    view.alpha = IDLE_ALPHA
    attachTouchHandling(view)
    attachDropHandling(view)

    windowManager.addView(view, params)
    bubble = view
    scheduleDim()
  }

  private fun scheduleDim() {
    handler.removeCallbacks(dimRunnable)
    bubble?.animate()?.alpha(1f)?.setDuration(120)?.start()
    handler.postDelayed(dimRunnable, IDLE_DIM_DELAY_MS)
  }

  // ----------------------------------------------------------------- dragging

  private fun attachTouchHandling(view: View) {
    var initialX = 0
    var initialY = 0
    var touchX = 0f
    var touchY = 0f
    var moved = false
    var downAt = 0L

    view.setOnTouchListener { v, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          touchX = event.rawX
          touchY = event.rawY
          moved = false
          downAt = System.currentTimeMillis()
          scheduleDim()
          true
        }

        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - touchX).roundToInt()
          val dy = (event.rawY - touchY).roundToInt()
          if (abs(dx) > TOUCH_SLOP_PX || abs(dy) > TOUCH_SLOP_PX) {
            moved = true
            showDismissZone()
          }
          params.x = initialX + dx
          params.y = initialY + dy
          runCatching { windowManager.updateViewLayout(v, params) }
          true
        }

        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          hideDismissZone()
          if (!moved) {
            val heldFor = System.currentTimeMillis() - downAt
            if (heldFor >= LONG_PRESS_MS) openApp(null) else onTapped()
          } else if (isOverDismissZone(event.rawY)) {
            snoozeAndStop()
          } else {
            snapToEdge(v)
            savePosition()
          }
          true
        }

        else -> false
      }
    }
  }

  /** Dock to whichever side is nearer, so it never floats mid-screen. */
  private fun snapToEdge(view: View) {
    val screenWidth = resources.displayMetrics.widthPixels
    val target = if (params.x + view.width / 2 < screenWidth / 2) {
      EDGE_MARGIN_PX
    } else {
      screenWidth - view.width - EDGE_MARGIN_PX
    }

    val start = params.x
    val animator = android.animation.ValueAnimator.ofInt(start, target)
    animator.duration = 160
    animator.addUpdateListener {
      params.x = it.animatedValue as Int
      runCatching { windowManager.updateViewLayout(view, params) }
    }
    animator.start()
  }

  // -------------------------------------------------------------- drop target

  /**
   * The gesture the product is built around: drag a link from any app onto the
   * bubble. Cross-app drags arrive as a global ClipData, which is the one
   * capture path with no platform restrictions.
   */
  private fun attachDropHandling(view: View) {
    view.setOnDragListener { v, event ->
      when (event.action) {
        DragEvent.ACTION_DRAG_STARTED -> {
          scheduleDim()
          v.animate().scaleX(1.2f).scaleY(1.2f).setDuration(120).start()
          // Only claim drags we can actually do something with.
          event.clipDescription?.hasMimeType(android.content.ClipDescription.MIMETYPE_TEXT_PLAIN) == true ||
            event.clipDescription?.hasMimeType("text/*") == true
        }

        DragEvent.ACTION_DRAG_ENTERED -> {
          v.animate().scaleX(1.35f).scaleY(1.35f).setDuration(90).start()
          true
        }

        DragEvent.ACTION_DRAG_EXITED -> {
          v.animate().scaleX(1.2f).scaleY(1.2f).setDuration(90).start()
          true
        }

        DragEvent.ACTION_DROP -> {
          v.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
          val text = extractText(event)
          if (text.isNullOrBlank()) {
            toast("Nothing to share in that")
          } else {
            capture(text, "bubble")
          }
          true
        }

        DragEvent.ACTION_DRAG_ENDED -> {
          v.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
          true
        }

        else -> false
      }
    }
  }

  private fun extractText(event: DragEvent): String? {
    val clip = event.clipData ?: return null
    for (i in 0 until clip.itemCount) {
      val item = clip.getItemAt(i)
      item.text?.toString()?.takeIf { it.isNotBlank() }?.let { return it }
      item.uri?.toString()?.takeIf { it.startsWith("http") }?.let { return it }
    }
    return null
  }

  // ----------------------------------------------------------------- tapping

  /**
   * Clipboard on tap.
   *
   * Android 10 and later only let an app read the clipboard while it holds
   * focus. The overlay can take focus briefly, which usually satisfies that —
   * but OEM builds vary, and when it comes back empty we open the app with its
   * composer instead of pretending nothing happened.
   */
  private fun onTapped() {
    val text = readClipboard()
    if (text.isNullOrBlank()) {
      openApp(null)
      return
    }
    capture(text, "bubble")
  }

  private fun readClipboard(): String? {
    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return null

    return try {
      // Take focus for the read, then immediately give it back.
      bubble?.let { view ->
        params.flags = params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
        runCatching { windowManager.updateViewLayout(view, params) }
      }

      val clip = clipboard.primaryClip
      val text = if (clip != null && clip.itemCount > 0) {
        clip.getItemAt(0).coerceToText(this)?.toString()
      } else {
        null
      }

      bubble?.let { view ->
        params.flags = params.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        runCatching { windowManager.updateViewLayout(view, params) }
      }

      text
    } catch (_: Exception) {
      null
    }
  }

  // ----------------------------------------------------------------- capture

  /**
   * The whole point: persist and confirm immediately, upload afterwards.
   * Nothing here touches the network, so the gesture stays inside doc 1 §4.3's
   * 300ms budget even on a dead connection.
   */
  private fun capture(rawInput: String, source: String) {
    ShareStore.enqueue(applicationContext, rawInput.trim(), source)
    ShareWorker.enqueue(applicationContext)

    haptic()
    toast("Sent to your groups")
    scheduleDim()
  }

  // ------------------------------------------------------------ dismiss zone

  private fun showDismissZone() {
    if (dismissZone != null) return

    val zone = FrameLayout.inflate(this, ShareR.layout.jobdrop_dismiss, null)
    val zoneParams = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      DISMISS_ZONE_HEIGHT_PX,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_PHONE
      },
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.BOTTOM }

    runCatching { windowManager.addView(zone, zoneParams) }
    dismissZone = zone
  }

  private fun hideDismissZone() {
    dismissZone?.let { runCatching { windowManager.removeView(it) } }
    dismissZone = null
  }

  private fun isOverDismissZone(rawY: Float): Boolean {
    val screenHeight = resources.displayMetrics.heightPixels
    return rawY > screenHeight - DISMISS_ZONE_HEIGHT_PX
  }

  /** Hidden, not uninstalled. It comes back on its own in four hours. */
  private fun snoozeAndStop() {
    getSharedPreferences(POSITION_PREFS, Context.MODE_PRIVATE)
      .edit()
      .putLong(KEY_SNOOZE_UNTIL, System.currentTimeMillis() + SNOOZE_MS)
      .apply()

    toast("Bubble hidden for 4 hours")
    stopSelf()
  }

  // ------------------------------------------------------------------ helpers

  private fun openApp(prefill: String?) {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      // Route straight to the composer rather than wherever they left the app.
      data = android.net.Uri.parse("jobdrop://share")
      if (prefill != null) putExtra("prefill", prefill)
    }
    runCatching { startActivity(launch) }
  }

  private fun haptic() {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    runCatching {
      vibrator.vibrate(VibrationEffect.createOneShot(18, VibrationEffect.DEFAULT_AMPLITUDE))
    }
  }

  private fun toast(message: String) {
    handler.post { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
  }

  private fun savePosition() {
    getSharedPreferences(POSITION_PREFS, Context.MODE_PRIVATE)
      .edit()
      .putInt(KEY_X, params.x)
      .putInt(KEY_Y, params.y)
      .apply()
  }

  private fun loadPosition(): Pair<Int, Int> {
    val prefs = getSharedPreferences(POSITION_PREFS, Context.MODE_PRIVATE)
    val defaultY = (resources.displayMetrics.heightPixels * 0.4f).roundToInt()
    return prefs.getInt(KEY_X, EDGE_MARGIN_PX) to prefs.getInt(KEY_Y, defaultY)
  }

  companion object {
    const val ACTION_STOP = "app.jobdrop.share.STOP_BUBBLE"

    private const val NOTIFICATION_ID = 4711
    private const val POSITION_PREFS = "jobdrop_bubble_position"
    private const val KEY_X = "x"
    private const val KEY_Y = "y"
    private const val KEY_SNOOZE_UNTIL = "snooze_until"

    private const val IDLE_ALPHA = 0.4f
    private const val IDLE_DIM_DELAY_MS = 3_000L
    private const val LONG_PRESS_MS = 400L
    private const val TOUCH_SLOP_PX = 12
    private const val EDGE_MARGIN_PX = 8
    private const val DISMISS_ZONE_HEIGHT_PX = 320
    private const val SNOOZE_MS = 4 * 60 * 60 * 1000L

    fun isSnoozed(context: Context): Boolean {
      val until = context
        .getSharedPreferences(POSITION_PREFS, Context.MODE_PRIVATE)
        .getLong(KEY_SNOOZE_UNTIL, 0L)
      return until > System.currentTimeMillis()
    }
  }
}
