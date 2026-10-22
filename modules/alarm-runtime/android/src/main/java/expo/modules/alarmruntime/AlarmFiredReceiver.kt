package expo.modules.alarmruntime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Punto de entrada sin JS cuando AlarmManager dispara una ocurrencia.
 *
 * Para modo ALARM arranca el foreground service de sonido. Para modo
 * NOTIFICATION solo publica una notificación estándar y no reproduce audio.
 */
class AlarmFiredReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != AlarmContract.ACTION_FIRE) return

    val key = intent.getStringExtra(AlarmContract.EXTRA_KEY) ?: return
    val store = AlarmStore(context)
    val occurrence = store.find(key) ?: return

    if (occurrence.status == AlarmOccurrence.STATUS_CANCELLED ||
      occurrence.status == AlarmOccurrence.STATUS_EXPIRED ||
      occurrence.dismissedAtEpochMs != null
    ) {
      return
    }

    val now = System.currentTimeMillis()
    if (occurrence.effectiveAtEpochMs > now + 60_000L) {
      // Disparo prematuro (por ejemplo, cambio de reloj): se reprograma.
      AlarmScheduler.schedule(context, occurrence)
      return
    }

    when (occurrence.mode) {
      AlarmOccurrence.MODE_NOTIFICATION -> {
        store.update(key) { record ->
          record.copy(
            status = AlarmOccurrence.STATUS_FIRED,
            firedAtEpochMs = now,
            updatedAtEpochMs = now,
          )
        }
        AlarmNotifications.showReminder(context, occurrence, silent = true)
      }
      else -> startAlarmService(context, store, key, occurrence, now)
    }
  }

  private fun startAlarmService(
    context: Context,
    store: AlarmStore,
    key: String,
    occurrence: AlarmOccurrence,
    now: Long,
  ) {
    val serviceIntent = Intent(context, AlarmService::class.java)
      .setAction(AlarmContract.ACTION_FIRE)
      .putExtra(AlarmContract.EXTRA_KEY, key)

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(serviceIntent)
      } else {
        context.startService(serviceIntent)
      }
    } catch (error: Exception) {
      store.update(key) { record ->
        record.copy(
          status = AlarmOccurrence.STATUS_FAILED,
          failureReason = "E_FGS_START:${error.message ?: error.javaClass.simpleName}",
          updatedAtEpochMs = System.currentTimeMillis(),
        )
      }
      // Todavía puede mostrarse un aviso visible, aunque no sea sonido sostenido.
      AlarmNotifications.showReminder(context, occurrence.copy(firedAtEpochMs = now))
    }
  }
}
