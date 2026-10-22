package expo.modules.alarmruntime

/** Rules use server-confirmed revisions; no push or local clock can authorize a decision. */
object AlarmPolicy {
  fun mayCrossCancellation(request: Int, decision: Int, barrierRequest: Int, barrierDecision: Int): Boolean =
    request >= barrierRequest && decision > barrierDecision

  fun mayFire(status: String, dismissed: Boolean, at: Long, now: Long): Boolean =
    status in setOf("SCHEDULED", "SCHEDULING") && !dismissed && now >= at && now - at <= 60_000L

  fun stale(request: Int, decision: Int, epoch: Long, latestRequest: Int, latestDecision: Int, latestEpoch: Long): Boolean =
    request < latestRequest || decision < latestDecision || epoch < latestEpoch
}
