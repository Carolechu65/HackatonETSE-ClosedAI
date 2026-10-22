package expo.modules.alarmruntime

import android.content.Context

/** Serializes intent → Android → receipt against cancellation and recovery in the same process. */
object AlarmCoordinator {
  fun schedule(context: Context, input: AlarmOccurrence): Map<String, Any?> = synchronized(AlarmStore.lock) {
    val store = AlarmStore(context)
    fun failed(reason: String) = mapOf("status" to "FAILED", "reason" to reason)
    if (input.mode != AlarmOccurrence.MODE_ALARM) return@synchronized failed("E_USE_EXPO_NOTIFICATIONS")
    val existing = store.find(input.key)
    if (store.isUnknownCancellation(input.key)) return@synchronized failed("E_CANCELLED_UNKNOWN_VERSION")
    if (existing?.status == AlarmOccurrence.STATUS_CANCELLED && !AlarmPolicy.mayCrossCancellation(input.requestVersion, input.decisionRevision, existing.requestVersion, existing.decisionRevision))
      return@synchronized failed("E_CANCELLED_VERSION")
    val sameDevice = store.snapshot().filter { it.userId == input.userId && it.deviceId == input.deviceId }
    val related = sameDevice.filter { it.requestId == input.requestId }
    if (AlarmPolicy.stale(input.requestVersion, input.decisionRevision, input.deviceEpoch,
        related.maxOfOrNull { it.requestVersion } ?: 0, related.maxOfOrNull { it.decisionRevision } ?: 0,
        sameDevice.maxOfOrNull { it.deviceEpoch } ?: 0)) return@synchronized failed("E_STALE_VERSION")
    var occurrence = input
    if (existing != null && existing.requestVersion == input.requestVersion && existing.decisionRevision == input.decisionRevision) {
      if (existing.title != input.title || existing.timeZone != input.timeZone || existing.mode != input.mode || existing.acceptedAtEpochMs != input.effectiveAtEpochMs)
        return@synchronized failed("E_VERSION_PAYLOAD_CONFLICT")
      if (existing.status in setOf(AlarmOccurrence.STATUS_FIRED, AlarmOccurrence.STATUS_EXPIRED) || existing.dismissedAtEpochMs != null)
        return@synchronized failed("E_ALREADY_FINISHED")
      occurrence = existing // Preserve native snooze, not the stale JS effective time.
    }
    if (occurrence.effectiveAtEpochMs <= System.currentTimeMillis()) return@synchronized failed("E_EXPIRED")
    sameDevice.filter { it.deviceEpoch < input.deviceEpoch || it.requestId == input.requestId && (it.requestVersion < input.requestVersion || it.decisionRevision < input.decisionRevision) }.forEach {
      store.upsert(it.copy(status = AlarmOccurrence.STATUS_CANCELLED))
      AlarmScheduler.cancel(context, it)
      AlarmService.stopKey(it.key)
      AlarmNotifications.cancel(context, it.key)
    }
    store.upsert(occurrence.copy(status = AlarmOccurrence.STATUS_SCHEDULING))
    val outcome = AlarmScheduler.schedule(context, occurrence)
    val status = when (outcome.status) {
      AlarmScheduler.STATUS_SCHEDULED -> AlarmOccurrence.STATUS_SCHEDULED
      AlarmScheduler.STATUS_EXPIRED -> AlarmOccurrence.STATUS_EXPIRED
      else -> AlarmOccurrence.STATUS_FAILED
    }
    try {
      store.upsert(occurrence.copy(status = status, failureReason = outcome.reason, updatedAtEpochMs = System.currentTimeMillis()))
    } catch (error: Exception) {
      AlarmScheduler.cancel(context, occurrence)
      throw error
    }
    if (status != AlarmOccurrence.STATUS_SCHEDULED) AlarmScheduler.cancel(context, occurrence)
    when (outcome.status) {
      AlarmScheduler.STATUS_SCHEDULED -> mapOf("status" to "SCHEDULED", "key" to occurrence.keyMap(), "scheduledAtEpochMs" to System.currentTimeMillis())
      AlarmScheduler.STATUS_PENDING_PERMISSION -> mapOf("status" to "PENDING_PERMISSION", "reason" to outcome.reason)
      else -> failed(outcome.reason ?: "E_SCHEDULE")
    }
  }

  fun cancel(context: Context, key: Map<String, Any?>): Map<String, Any?> = synchronized(AlarmStore.lock) {
    try {
      val id = AlarmContract.keyOf(key)
      val store = AlarmStore(context)
      val existing = store.find(id)
      if (existing != null) store.upsert(existing.copy(status = AlarmOccurrence.STATUS_CANCELLED, dismissedAtEpochMs = System.currentTimeMillis()))
      else store.cancelUnknown(id)
      val cancelled = AlarmScheduler.cancelKey(context, id)
      AlarmService.stopKey(id)
      AlarmNotifications.cancel(context, id)
      if (cancelled) mapOf("status" to "CANCELLED", "key" to key)
      else mapOf("status" to "CANCEL_PENDING", "reason" to "E_ANDROID_CANCEL")
    } catch (_: Exception) { mapOf("status" to "CANCEL_PENDING", "reason" to "E_NATIVE_CANCEL") }
  }
}
