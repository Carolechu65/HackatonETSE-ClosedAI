package expo.modules.alarmruntime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Reconstruye alarmas futuras tras reinicio, cambio de hora/zona o actualización.
 *
 * Una ocurrencia ya vencida se marca EXPIRED; nunca se hace sonar tarde al
 * recuperar el dispositivo.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED,
      android.app.AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> AlarmRecovery.reconcile(context)
    }
  }
}
