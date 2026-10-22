package expo.modules.alarmruntime

import android.content.Context

data class RecoverySummary(
  val rescheduled: Int,
  val expired: Int,
  val failed: Int,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "rescheduled" to rescheduled,
    "expired" to expired,
    "failed" to failed,
  )
}

/**
 * Recuperación idempotente. Reintenta SCHEDULING/SCHEDULED y los fallos que
 * solo dependían de un permiso ahora concedido. No resucita CANCELLED, FIRED
 * ni EXPIRED.
 */
object AlarmRecovery {
  fun reconcile(context: Context): RecoverySummary = synchronized(AlarmStore.lock) {
    val store = AlarmStore(context)
    val now = System.currentTimeMillis()
    var rescheduled = 0
    var expired = 0
    var failed = 0

    for (occurrence in store.snapshot()) {
      val failureReason = occurrence.failureReason
      val awaitingPermission = occurrence.status == AlarmOccurrence.STATUS_FAILED &&
        failureReason != null &&
        failureReason in PERMISSION_FAILURES
      if (occurrence.status != AlarmOccurrence.STATUS_SCHEDULED &&
        occurrence.status != AlarmOccurrence.STATUS_SCHEDULING &&
        !awaitingPermission
      ) {
        continue
      }

      if (occurrence.effectiveAtEpochMs <= now) {
        AlarmScheduler.cancel(context, occurrence)
        store.update(occurrence.key) { record ->
          record.copy(
            status = AlarmOccurrence.STATUS_EXPIRED,
            failureReason = "E_MISSED",
            updatedAtEpochMs = now,
          )
        }
        expired += 1
        continue
      }

      val outcome = AlarmScheduler.schedule(context, occurrence)
      if (outcome.status == AlarmScheduler.STATUS_SCHEDULED) {
        store.update(occurrence.key) { record ->
          record.copy(
            status = AlarmOccurrence.STATUS_SCHEDULED,
            scheduledAtEpochMs = occurrence.effectiveAtEpochMs,
            failureReason = null,
            updatedAtEpochMs = now,
          )
        }
        rescheduled += 1
      } else {
        AlarmScheduler.cancel(context, occurrence)
        store.update(occurrence.key) { record ->
          record.copy(
            status = AlarmOccurrence.STATUS_FAILED,
            failureReason = outcome.reason ?: "E_RECOVERY",
            updatedAtEpochMs = now,
          )
        }
        failed += 1
      }
    }

    RecoverySummary(rescheduled = rescheduled, expired = expired, failed = failed)
  }

  private val PERMISSION_FAILURES = setOf(
    "E_EXACT_ALARM_PERMISSION",
    "E_NOTIFICATION_PERMISSION",
  )
}
