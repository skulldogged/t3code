package expo.modules.t3backgroundconnection

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** Android 16 promoted ongoing notification used by System UI as a Live Update. */
internal object T3AgentLiveUpdate {
  private const val CHANNEL_ID = "t3code_agent_live_status"
  private const val NOTIFICATION_ID = 0x7435
  private const val CONTENT_REQUEST_CODE = 0x7435
  private const val DISMISS_REQUEST_CODE = 0x7436
  private const val PREFERENCES_NAME = "t3_agent_live_update"
  private const val DISMISSED_ACTIVITY_KEY = "dismissed_activity_key"
  internal const val ACTIVITY_KEY_EXTRA = "activity_key"

  fun status(context: Context): Map<String, Any> {
    val manager = NotificationManagerCompat.from(context)
    return mapOf(
      "supported" to (Build.VERSION.SDK_INT >= 36),
      "notificationsEnabled" to manager.areNotificationsEnabled(),
      "promotionAllowed" to (
        Build.VERSION.SDK_INT >= 36 && manager.canPostPromotedNotifications()
      ),
    )
  }

  @SuppressLint("MissingPermission")
  fun publish(
    context: Context,
    title: String,
    text: String,
    shortCriticalText: String,
    deepLinkUrl: String,
    color: String,
  ): Boolean {
    createChannel(context)
    if (wasDismissed(context, deepLinkUrl)) return false
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return false

    val smallIcon = context.resources.getIdentifier(
      "notification_icon",
      "drawable",
      context.packageName,
    ).takeIf { it != 0 } ?: android.R.drawable.stat_notify_sync_noanim

    val contentIntent = deepLinkIntent(context, deepLinkUrl)?.let { intent ->
      PendingIntent.getActivity(
        context,
        CONTENT_REQUEST_CODE,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val deleteIntent = PendingIntent.getBroadcast(
      context,
      DISMISS_REQUEST_CODE,
      Intent(context, T3AgentLiveUpdateDismissedReceiver::class.java).apply {
        putExtra(ACTIVITY_KEY_EXTRA, deepLinkUrl)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setContentTitle(title.take(96))
      .setContentText(text.take(160))
      .setStyle(NotificationCompat.BigTextStyle().bigText(text.take(512)))
      .setShortCriticalText(shortCriticalText.take(7))
      .setRequestPromotedOngoing(true)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setAutoCancel(false)
      .setDeleteIntent(deleteIntent)
      .setSilent(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPriority(NotificationCompat.PRIORITY_LOW)

    contentIntent?.let(builder::setContentIntent)
    parseColor(color)?.let(builder::setColor)

    return try {
      manager.notify(NOTIFICATION_ID, builder.build())
      true
    } catch (_: SecurityException) {
      false
    }
  }

  fun end(context: Context) {
    hide(context)
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(DISMISSED_ACTIVITY_KEY)
      .apply()
  }

  fun hide(context: Context) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }

  internal fun markDismissed(context: Context, activityKey: String) {
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(DISMISSED_ACTIVITY_KEY, activityKey)
      .apply()
  }

  private fun wasDismissed(context: Context, activityKey: String): Boolean =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .getString(DISMISSED_ACTIVITY_KEY, null) == activityKey

  fun openPromotionSettings(context: Context) {
    val intent = if (Build.VERSION.SDK_INT >= 36) {
      Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS).apply {
        putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        data = Uri.parse("package:${context.packageName}")
      }
    } else {
      Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
        putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      }
    }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  private fun createChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Live agent status",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Live status for active T3 Code sessions"
      setSound(null, null)
      enableLights(false)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun deepLinkIntent(context: Context, deepLinkUrl: String): Intent? {
    val uri = runCatching { Uri.parse(deepLinkUrl) }.getOrNull() ?: return null
    if (uri.scheme.isNullOrBlank()) return null
    return Intent(Intent.ACTION_VIEW, uri).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
  }

  private fun parseColor(value: String): Int? =
    runCatching { Color.parseColor(value) }.getOrNull()
}
