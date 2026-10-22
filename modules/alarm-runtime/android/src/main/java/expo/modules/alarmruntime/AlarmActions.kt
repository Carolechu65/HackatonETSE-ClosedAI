package expo.modules.alarmruntime

import android.content.Context

/** Explicit local actions; never mutate a task or server consent. */
object AlarmActions {
  fun stop(context: Context, key: String): Boolean = synchronized(AlarmStore.lock) {
    val store = AlarmStore(context)
    val occurrence = store.find(key) ?: return@synchronized false
    // Persist first: a queued receiver cannot restart playback after the stop.
    store.upsert(occurrence.copy(status = AlarmOccurrence.STATUS_CANCELLED,
      dismissedAtEpochMs = System.currentTimeMillis(), updatedAtEpochMs = System.currentTimeMillis()))
    val cancelled = AlarmScheduler.cancel(context, occurrence)
    AlarmService.stopKey(key)
    AlarmNotifications.cancel(context, key)
    cancelled
  }

  fun snooze(context: Context, key: String, minutes: Int): ScheduleOutcome = synchronized(AlarmStore.lock) {
    if (minutes !in 1..60) return@synchronized ScheduleOutcome(AlarmScheduler.STATUS_FAILED, "E_SNOOZE_DURATION")
    val store = AlarmStore(context)
    val occurrence = store.find(key) ?: return@synchronized ScheduleOutcome(AlarmScheduler.STATUS_FAILED, "E_NOT_FOUND")
    if (occurrence.status != AlarmOccurrence.STATUS_FIRED || occurrence.dismissedAtEpochMs != null)
      return@synchronized ScheduleOutcome(AlarmScheduler.STATUS_FAILED, "E_NOT_RINGING")
    val now = System.currentTimeMillis()
    val next = occurrence.copy(status = AlarmOccurrence.STATUS_SCHEDULING,
      effectiveAtEpochMs = now + minutes * 60_000L, scheduledAtEpochMs = now + minutes * 60_000L,
      firedAtEpochMs = null, dismissedAtEpochMs = null, snoozeCount = occurrence.snoozeCount + 1,
      failureReason = null, updatedAtEpochMs = now)
    store.upsert(next)
    val outcome = AlarmScheduler.schedule(context, next)
    try {
      store.upsert(next.copy(status = if (outcome.status == AlarmScheduler.STATUS_SCHEDULED) AlarmOccurrence.STATUS_SCHEDULED else AlarmOccurrence.STATUS_FAILED,
        failureReason = outcome.reason, updatedAtEpochMs = System.currentTimeMillis()))
    } catch (error: Exception) { AlarmScheduler.cancel(context, next); throw error }
    AlarmService.stopKey(key)
    AlarmNotifications.cancel(context, key)
    outcome
  }
}
