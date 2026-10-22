package expo.modules.alarmruntime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Acciones de la notificación: detener y posponer sin abrir la app. */
class AlarmActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val key = intent.getStringExtra(AlarmContract.EXTRA_KEY) ?: return
    when (intent.action) {
      AlarmContract.ACTION_STOP -> AlarmActions.stop(context, key)
      AlarmContract.ACTION_SNOOZE -> AlarmActions.snooze(
        context,
        key,
        intent.getIntExtra(
          AlarmContract.EXTRA_SNOOZE_MINUTES,
          AlarmContract.DEFAULT_SNOOZE_MINUTES,
        ),
      )
    }
  }
}
