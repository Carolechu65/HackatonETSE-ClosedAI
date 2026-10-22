package expo.modules.alarmruntime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import android.text.format.DateFormat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.Date

/**
 * Canales y notificaciones locales del runtime.
 *
 * El canal de alarma es silencioso a propósito: el audio lo controla
 * AlarmService con USAGE_ALARM. Así no se reproducen dos sonidos a la vez.
 */
object AlarmNotifications {
  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return

    val alarmChannel = NotificationChannel(
      AlarmContract.CHANNEL_ALARM,
      "Alarmas",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Alarmas sonoras con detener y posponer"
      setSound(null, null)
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 500, 250, 500)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setShowBadge(true)
    }

    val reminderChannel = NotificationChannel(
      AlarmContract.CHANNEL_REMINDER,
      "Recordatorios",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Avisos estándar sin sonido sostenido"
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setShowBadge(true)
    }

    val silentChannel = NotificationChannel(
      AlarmContract.CHANNEL_SILENT,
      "Avisos silenciosos",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "Recordatorios de tareas silenciados por el usuario"
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setShowBadge(true)
    }

    manager.createNotificationChannel(alarmChannel)
    manager.createNotificationChannel(reminderChannel)
    manager.createNotificationChannel(silentChannel)
  }

  fun buildAlarmNotification(context: Context, occurrence: AlarmOccurrence): Notification {
    ensureChannels(context)
    val key = occurrence.key
    val openIntent = AlarmContract.activityPendingIntent(context, key)
    val stopIntent = AlarmContract.actionPendingIntent(context, AlarmContract.ACTION_STOP, key)
    val snoozeIntent = AlarmContract.actionPendingIntent(
      context,
      AlarmContract.ACTION_SNOOZE,
      key,
      AlarmContract.DEFAULT_SNOOZE_MINUTES,
    )

    val builder = NotificationCompat.Builder(context, AlarmContract.CHANNEL_ALARM)
      .setSmallIcon(R.drawable.ic_alarm_runtime)
      .setContentTitle(occurrence.title.ifBlank { "Alarma" })
      .setContentText("Alarma · toca para abrir")
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setWhen(occurrence.effectiveAtEpochMs)
      .setShowWhen(true)
      .setOngoing(true)
      .setAutoCancel(false)
      .setContentIntent(openIntent)
      .addAction(0, "Detener", stopIntent)
      .addAction(0, "Posponer ${AlarmContract.DEFAULT_SNOOZE_MINUTES} min", snoozeIntent)

    if (canUseFullScreenIntent(context)) {
      builder.setFullScreenIntent(openIntent, true)
    }

    return builder.build()
  }

  fun showReminder(context: Context, occurrence: AlarmOccurrence, silent: Boolean = false) {
    ensureChannels(context)
    val key = occurrence.key
    val openIntent = AlarmContract.activityPendingIntent(context, key)
    val stopIntent = AlarmContract.actionPendingIntent(context, AlarmContract.ACTION_STOP, key)
    val snoozeIntent = AlarmContract.actionPendingIntent(
      context,
      AlarmContract.ACTION_SNOOZE,
      key,
      AlarmContract.DEFAULT_SNOOZE_MINUTES,
    )
    val time = DateFormat.getTimeFormat(context).format(Date(occurrence.effectiveAtEpochMs))
    val channel = if (silent) AlarmContract.CHANNEL_SILENT else AlarmContract.CHANNEL_REMINDER

    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(R.drawable.ic_alarm_runtime)
      .setContentTitle(occurrence.title.ifBlank { "Recordatorio" })
      .setContentText("Recordatorio de las $time")
      .setCategory(NotificationCompat.CATEGORY_EVENT)
      .setPriority(if (silent) NotificationCompat.PRIORITY_DEFAULT else NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(openIntent)
      .setAutoCancel(true)
      .addAction(0, "Detener", stopIntent)
      .addAction(0, "Posponer ${AlarmContract.DEFAULT_SNOOZE_MINUTES} min", snoozeIntent)

    if (silent) builder.setSilent(true)

    notify(context, key, builder.build())
  }

  fun notify(context: Context, key: String, notification: Notification) {
    try {
      NotificationManagerCompat.from(context)
        .notify(AlarmContract.notificationId(key), notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS denegado: la alarma existente sigue en el store,
      // pero el usuario debe resolver el permiso antes de contar con aviso visible.
    }
  }

  fun cancel(context: Context, key: String) {
    NotificationManagerCompat.from(context).cancel(AlarmContract.notificationId(key))
  }

  private fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
    val manager = context.getSystemService(NotificationManager::class.java) ?: return false
    return manager.canUseFullScreenIntent()
  }
}
