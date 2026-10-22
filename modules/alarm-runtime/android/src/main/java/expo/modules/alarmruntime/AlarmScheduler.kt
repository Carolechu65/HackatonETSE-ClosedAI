package expo.modules.alarmruntime

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.os.Build

data class ScheduleOutcome(
  val status: String,
  val reason: String? = null,
  val scheduledAtEpochMs: Long? = null,
)

/**
 * Programación exacta con AlarmManager.
 *
 * Se usa setAlarmClock porque el caso de producto es una alarma de reloj:
 * muestra el indicador del sistema y está exenta de Doze. Antes de programar se
 * comprueba el acceso especial a alarmas exactas.
 */
object AlarmScheduler {
  const val STATUS_SCHEDULED = "SCHEDULED"
  const val STATUS_PENDING_PERMISSION = "PENDING_PERMISSION"
  const val STATUS_FAILED = "FAILED"
  const val STATUS_EXPIRED = "EXPIRED"

  fun canScheduleExactAlarms(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val manager = context.getSystemService(AlarmManager::class.java) ?: return false
    return manager.canScheduleExactAlarms()
  }

  fun schedule(context: Context, occurrence: AlarmOccurrence): ScheduleOutcome {
    if (!canScheduleExactAlarms(context)) {
      return ScheduleOutcome(STATUS_PENDING_PERMISSION, "E_EXACT_ALARM_PERMISSION")
    }

    // Regla de producto: sin un aviso visible no se declara lista una alarma.
    if (!notificationsEnabled(context)) {
      return ScheduleOutcome(STATUS_PENDING_PERMISSION, "E_NOTIFICATION_PERMISSION")
    }

    val now = System.currentTimeMillis()
    if (occurrence.effectiveAtEpochMs <= now) {
      return ScheduleOutcome(STATUS_EXPIRED, "E_PAST")
    }

    val manager = context.getSystemService(AlarmManager::class.java)
      ?: return ScheduleOutcome(STATUS_FAILED, "E_ALARM_MANAGER_UNAVAILABLE")

    return try {
      val operation = AlarmContract.firePendingIntent(context, occurrence.key)
      val showIntent = AlarmContract.activityPendingIntent(context, occurrence.key)
      manager.setAlarmClock(
        AlarmManager.AlarmClockInfo(occurrence.effectiveAtEpochMs, showIntent),
        operation,
      )
      ScheduleOutcome(STATUS_SCHEDULED, scheduledAtEpochMs = occurrence.effectiveAtEpochMs)
    } catch (error: SecurityException) {
      ScheduleOutcome(STATUS_FAILED, "E_SECURITY:${error.message ?: "exact alarm"}")
    } catch (error: Exception) {
      ScheduleOutcome(STATUS_FAILED, "E_SCHEDULE:${error.message ?: error.javaClass.simpleName}")
    }
  }

  fun cancel(context: Context, occurrence: AlarmOccurrence): Boolean {
    val manager = context.getSystemService(AlarmManager::class.java) ?: return false
    return try {
      manager.cancel(AlarmContract.firePendingIntent(context, occurrence.key))
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun notificationsEnabled(context: Context): Boolean {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return false
    return manager.areNotificationsEnabled()
  }
}
