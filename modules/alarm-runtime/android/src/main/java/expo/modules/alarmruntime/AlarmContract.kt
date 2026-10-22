package expo.modules.alarmruntime

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Nombres, extras y PendingIntents compartidos por el runtime.
 *
 * La identidad de una ocurrencia es estable y viaja siempre con la alarma. El
 * receptor y el servicio no necesitan React ni Firebase para decidir qué suena.
 */
object AlarmContract {
  const val ACTION_FIRE = "expo.modules.alarmruntime.action.FIRE"
  const val ACTION_STOP = "expo.modules.alarmruntime.action.STOP"
  const val ACTION_SNOOZE = "expo.modules.alarmruntime.action.SNOOZE"

  const val EXTRA_KEY = "expo.modules.alarmruntime.extra.KEY"
  const val EXTRA_SNOOZE_MINUTES = "expo.modules.alarmruntime.extra.SNOOZE_MINUTES"

  const val CHANNEL_ALARM = "alarm_runtime_alarm_v1"
  const val CHANNEL_REMINDER = "alarm_runtime_reminder_v1"
  const val CHANNEL_SILENT = "alarm_runtime_silent_v1"

  const val DEFAULT_SNOOZE_MINUTES = 5
  const val MAX_ALARM_DURATION_MS = 10 * 60 * 1000L

  private const val PENDING_INTENT_FLAGS =
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  fun keyOf(
    userId: String,
    requestId: String,
    occurrenceId: String,
    deviceId: String,
    deviceEpoch: Long,
  ): String = listOf(userId, requestId, occurrenceId, deviceId, deviceEpoch.toString())
    .joinToString("|")

  fun keyOf(key: Map<String, Any?>): String = keyOf(
    userId = key.requireString("userId"),
    requestId = key.requireString("requestId"),
    occurrenceId = key.requireString("occurrenceId"),
    deviceId = key.requireString("deviceId"),
    deviceEpoch = key.requireLong("deviceEpoch"),
  )

  fun dataUri(key: String): Uri = Uri.Builder()
    .scheme("alarmat")
    .authority("alarm-runtime")
    .appendPath(key)
    .build()

  /** PendingIntent que despierta el receptor cuando llega la hora. */
  fun firePendingIntent(context: Context, key: String): PendingIntent {
    val intent = Intent(context, AlarmFiredReceiver::class.java)
      .setAction(ACTION_FIRE)
      .setData(dataUri(key))
      .putExtra(EXTRA_KEY, key)
    return PendingIntent.getBroadcast(context, key.hashCode(), intent, PENDING_INTENT_FLAGS)
  }

  /** Pantalla que Android muestra al tocar la notificación o como full-screen intent. */
  fun activityPendingIntent(context: Context, key: String): PendingIntent {
    val intent = Intent(context, AlarmActivity::class.java)
      .setAction(ACTION_FIRE)
      .setData(dataUri(key))
      .putExtra(EXTRA_KEY, key)
    return PendingIntent.getActivity(context, key.hashCode(), intent, PENDING_INTENT_FLAGS)
  }

  fun actionPendingIntent(
    context: Context,
    action: String,
    key: String,
    snoozeMinutes: Int = DEFAULT_SNOOZE_MINUTES,
  ): PendingIntent {
    val intent = Intent(context, AlarmActionReceiver::class.java)
      .setAction(action)
      .setData(dataUri(key))
      .putExtra(EXTRA_KEY, key)
      .putExtra(EXTRA_SNOOZE_MINUTES, snoozeMinutes)
    return PendingIntent.getBroadcast(context, key.hashCode(), intent, PENDING_INTENT_FLAGS)
  }

  /** El hash puede repetirse; el ID solo se usa para notificaciones, no como identidad. */
  fun notificationId(key: String): Int = 7100 + ((key.hashCode() and 0x7fffffff) % 100000)
}

internal fun Map<String, Any?>.requireString(name: String): String =
  (this[name] as? String)?.takeIf { it.isNotBlank() }
    ?: throw IllegalArgumentException("$name is required")

internal fun Map<String, Any?>.requireLong(name: String): Long = when (val value = this[name]) {
  is Number -> value.toLong()
  is String -> value.toLongOrNull()
  else -> null
} ?: throw IllegalArgumentException("$name must be a number")

internal fun Map<String, Any?>.requireInt(name: String): Int = requireLong(name).toInt()

internal fun Map<String, Any?>.optionalString(name: String): String? =
  (this[name] as? String)?.takeIf { it.isNotBlank() }
