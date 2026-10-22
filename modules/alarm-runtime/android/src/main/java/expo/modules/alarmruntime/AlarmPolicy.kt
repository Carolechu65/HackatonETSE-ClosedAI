package expo.modules.alarmruntime

/** Rules use server-confirmed revisions; no push or local clock can authorize a decision. */
object AlarmPolicy {
  const val TASK_REPEAT_MINUTES = 10
  const val TASK_RING_DURATION_MS = 60_000L

  fun nextTaskReminderAt(firedAt: Long?, now: Long): Long =
    maxOf((firedAt ?: now) + TASK_REPEAT_MINUTES * 60_000L, now + 1_000L)

  fun shouldRepeatTask(taskId: String?, mode: String, status: String, dismissed: Boolean): Boolean =
    !taskId.isNullOrBlank() && mode == "ALARM" && status == "FIRED" && !dismissed

  fun mayCrossCancellation(request: Int, decision: Int, barrierRequest: Int, barrierDecision: Int): Boolean =
    request >= barrierRequest && decision > barrierDecision

  fun mayFire(status: String, dismissed: Boolean, at: Long, now: Long): Boolean =
    status in setOf("SCHEDULED", "SCHEDULING") && !dismissed && now >= at && now - at <= 60_000L

  fun stale(request: Int, decision: Int, epoch: Long, latestRequest: Int, latestDecision: Int, latestEpoch: Long): Boolean =
    request < latestRequest || decision < latestDecision || epoch < latestEpoch
}
