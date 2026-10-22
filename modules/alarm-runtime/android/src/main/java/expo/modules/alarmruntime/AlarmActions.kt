package expo.modules.alarmruntime

import android.content.Context
import android.content.Intent

/** Acciones compartidas por notificación, pantalla de alarma y puente JS. */
object AlarmActions {
  fun stop(context: Context, key: String): Boolean {
    context.stopService(Intent(context, AlarmService::class.java))

    val store = AlarmStore(context)
    val occurrence = store.find(key)
    if (occurrence != null) {
      // Seguro si el usuario pulsa Detener antes de que llegue la hora:
      // no debe quedar un PendingIntent que suene después.
      AlarmScheduler.cancel(context, occurrence)
    }

    val now = System.currentTimeMillis()
    val updated = store.update(key) { record ->
      val wasRinging = record.status == AlarmOccurrence.STATUS_FIRED ||
        record.firedAtEpochMs != null
      record.copy(
        status = if (wasRinging) {
          AlarmOccurrence.STATUS_FIRED
        } else {
          AlarmOccurrence.STATUS_CANCELLED
        },
        dismissedAtEpochMs = now,
        updatedAtEpochMs = now,
      )
    }
    AlarmNotifications.cancel(context, key)
    return updated != null
  }

  fun snooze(context: Context, key: String, minutes: Int): ScheduleOutcome {
    context.stopService(Intent(context, AlarmService::class.java))
    AlarmNotifications.cancel(context, key)

    val store = AlarmStore(context)
    val occurrence = store.find(key)
      ?: return ScheduleOutcome(AlarmScheduler.STATUS_FAILED, "E_NOT_FOUND")
    if (occurrence.status == AlarmOccurrence.STATUS_CANCELLED ||
      occurrence.status == AlarmOccurrence.STATUS_EXPIRED
    ) {
      return ScheduleOutcome(AlarmScheduler.STATUS_FAILED, "E_NOT_ACTIVE")
    }

    val now = System.currentTimeMillis()
    val snoozeMs = minutes.coerceIn(1, 60) * 60_000L
    val next = occurrence.copy(
      status = AlarmOccurrence.STATUS_SCHEDULING,
      effectiveAtEpochMs = now + snoozeMs,
      scheduledAtEpochMs = now + snoozeMs,
      firedAtEpochMs = null,
      dismissedAtEpochMs = null,
      snoozeCount = occurrence.snoozeCount + 1,
      failureReason = null,
      updatedAtEpochMs = now,
    )
    store.upsert(next)

    val outcome = AlarmScheduler.schedule(context, next)
    store.update(next.key) { saved ->
      when (outcome.status) {
        AlarmScheduler.STATUS_SCHEDULED -> saved.copy(
          status = AlarmOccurrence.STATUS_SCHEDULED,
          scheduledAtEpochMs = next.effectiveAtEpochMs,
          failureReason = null,
          updatedAtEpochMs = System.currentTimeMillis(),
        )
        AlarmScheduler.STATUS_EXPIRED -> saved.copy(
          status = AlarmOccurrence.STATUS_EXPIRED,
          failureReason = outcome.reason,
          updatedAtEpochMs = System.currentTimeMillis(),
        )
        else -> saved.copy(
          status = AlarmOccurrence.STATUS_FAILED,
          failureReason = outcome.reason,
          updatedAtEpochMs = System.currentTimeMillis(),
        )
      }
    }
    return outcome
  }
}
