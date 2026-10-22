package expo.modules.alarmruntime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Native-only delivery. Reject terminal, old, early and already-consumed intents. */
class AlarmFiredReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != AlarmContract.ACTION_FIRE) return
    val key = intent.getStringExtra(AlarmContract.EXTRA_KEY) ?: return
    synchronized(AlarmStore.lock) {
      val store = AlarmStore(context)
      try {
        val occurrence = store.find(key) ?: return
        val now = System.currentTimeMillis()
        if (!AlarmPolicy.mayFire(occurrence.status, occurrence.dismissedAtEpochMs != null, occurrence.effectiveAtEpochMs, now)) {
          if (occurrence.status in setOf(AlarmOccurrence.STATUS_SCHEDULED, AlarmOccurrence.STATUS_SCHEDULING) && now - occurrence.effectiveAtEpochMs > 60_000L)
            store.upsert(occurrence.copy(status = AlarmOccurrence.STATUS_EXPIRED, failureReason = "E_MISSED"))
          return
        }
        if (occurrence.mode != AlarmOccurrence.MODE_ALARM || !AlarmScheduler.notificationsEnabled(context) || !AlarmScheduler.canScheduleExactAlarms(context)) {
          store.upsert(occurrence.copy(status = AlarmOccurrence.STATUS_FAILED, failureReason = "E_PRESENTATION_UNAVAILABLE"))
          return
        }
        // Claim before starting the service; duplicate deliveries cannot play twice.
        store.upsert(occurrence.copy(status = AlarmOccurrence.STATUS_FIRED, firedAtEpochMs = now))
        val service = Intent(context, AlarmService::class.java).setAction(AlarmContract.ACTION_FIRE).putExtra(AlarmContract.EXTRA_KEY, key)
        if (android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(service) else context.startService(service)
      } catch (_: Exception) {
        // No silent degradation from accepted audible alarm to a standard reminder.
        runCatching { store.update(key) { it.copy(status = AlarmOccurrence.STATUS_FAILED, failureReason = "E_FGS_START") } }
      }
    }
  }
}
