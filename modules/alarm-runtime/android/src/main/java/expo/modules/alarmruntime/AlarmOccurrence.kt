package expo.modules.alarmruntime

import org.json.JSONObject

/**
 * Registro operativo de una ocurrencia local.
 *
 * Es la fuente de verdad para el receptor y el servicio. Los estados coinciden
 * con el contrato TypeScript de `src/platform/alarms`.
 */
data class AlarmOccurrence(
  val userId: String,
  val requestId: String,
  val occurrenceId: String,
  val deviceId: String,
  val deviceEpoch: Long,
  val requestVersion: Int,
  val decisionRevision: Int,
  val effectiveAtEpochMs: Long,
  val timeZone: String,
  val title: String,
  val mode: String,
  val status: String = STATUS_SCHEDULED,
  val scheduledAtEpochMs: Long = effectiveAtEpochMs,
  val firedAtEpochMs: Long? = null,
  val dismissedAtEpochMs: Long? = null,
  val snoozeCount: Int = 0,
  val failureReason: String? = null,
  val updatedAtEpochMs: Long = System.currentTimeMillis(),
) {
  val key: String
    get() = AlarmContract.keyOf(userId, requestId, occurrenceId, deviceId, deviceEpoch)

  fun keyMap(): Map<String, Any?> = mapOf(
    "userId" to userId,
    "requestId" to requestId,
    "occurrenceId" to occurrenceId,
    "deviceId" to deviceId,
    "deviceEpoch" to deviceEpoch,
  )

  fun specMap(): Map<String, Any?> = keyMap() + mapOf(
    "requestVersion" to requestVersion,
    "decisionRevision" to decisionRevision,
    "effectiveAtEpochMs" to effectiveAtEpochMs,
    "timeZone" to timeZone,
    "title" to title,
    "mode" to mode,
  )

  fun snapshotMap(): Map<String, Any?> {
    val result = mutableMapOf<String, Any?>(
      "spec" to specMap(),
      "status" to status,
      "scheduledAtEpochMs" to scheduledAtEpochMs,
      "snoozeCount" to snoozeCount,
    )
    firedAtEpochMs?.let { result["firedAtEpochMs"] = it }
    dismissedAtEpochMs?.let { result["dismissedAtEpochMs"] = it }
    failureReason?.let { result["failureReason"] = it }
    return result
  }

  fun toJson(): JSONObject = JSONObject().apply {
    put("userId", userId)
    put("requestId", requestId)
    put("occurrenceId", occurrenceId)
    put("deviceId", deviceId)
    put("deviceEpoch", deviceEpoch)
    put("requestVersion", requestVersion)
    put("decisionRevision", decisionRevision)
    put("effectiveAtEpochMs", effectiveAtEpochMs)
    put("timeZone", timeZone)
    put("title", title)
    put("mode", mode)
    put("status", status)
    put("scheduledAtEpochMs", scheduledAtEpochMs)
    put("snoozeCount", snoozeCount)
    put("updatedAtEpochMs", updatedAtEpochMs)
    firedAtEpochMs?.let { put("firedAtEpochMs", it) }
    dismissedAtEpochMs?.let { put("dismissedAtEpochMs", it) }
    failureReason?.let { put("failureReason", it) }
  }

  companion object {
    const val STATUS_SCHEDULING = "SCHEDULING"
    const val STATUS_SCHEDULED = "SCHEDULED"
    const val STATUS_CANCELLED = "CANCELLED"
    const val STATUS_FIRED = "FIRED"
    const val STATUS_FAILED = "FAILED"
    const val STATUS_EXPIRED = "EXPIRED"

    const val MODE_ALARM = "ALARM"
    const val MODE_NOTIFICATION = "NOTIFICATION"

    fun fromSpec(spec: Map<String, Any?>): AlarmOccurrence = AlarmOccurrence(
      userId = spec.requireString("userId"),
      requestId = spec.requireString("requestId"),
      occurrenceId = spec.requireString("occurrenceId"),
      deviceId = spec.requireString("deviceId"),
      deviceEpoch = spec.requireLong("deviceEpoch"),
      requestVersion = spec.requireInt("requestVersion"),
      decisionRevision = spec.requireInt("decisionRevision"),
      effectiveAtEpochMs = spec.requireLong("effectiveAtEpochMs"),
      timeZone = spec.requireString("timeZone"),
      title = spec.requireString("title"),
      mode = spec.optionalString("mode") ?: MODE_ALARM,
    ).also { occurrence ->
      require(occurrence.mode == MODE_ALARM || occurrence.mode == MODE_NOTIFICATION) {
        "mode must be ALARM or NOTIFICATION"
      }
      require(occurrence.effectiveAtEpochMs > 0) { "effectiveAtEpochMs must be positive" }
    }

    fun fromJson(json: JSONObject): AlarmOccurrence = AlarmOccurrence(
      userId = json.getString("userId"),
      requestId = json.getString("requestId"),
      occurrenceId = json.getString("occurrenceId"),
      deviceId = json.getString("deviceId"),
      deviceEpoch = json.getLong("deviceEpoch"),
      requestVersion = json.getInt("requestVersion"),
      decisionRevision = json.getInt("decisionRevision"),
      effectiveAtEpochMs = json.getLong("effectiveAtEpochMs"),
      timeZone = json.getString("timeZone"),
      title = json.getString("title"),
      mode = json.optString("mode", MODE_ALARM),
      status = json.optString("status", STATUS_SCHEDULED),
      scheduledAtEpochMs = json.optLong("scheduledAtEpochMs", json.getLong("effectiveAtEpochMs")),
      firedAtEpochMs = json.optNullableLong("firedAtEpochMs"),
      dismissedAtEpochMs = json.optNullableLong("dismissedAtEpochMs"),
      snoozeCount = json.optInt("snoozeCount", 0),
      failureReason = json.optString("failureReason").takeIf { it.isNotEmpty() },
      updatedAtEpochMs = json.optLong("updatedAtEpochMs", System.currentTimeMillis()),
    )
  }
}

private fun JSONObject.optNullableLong(name: String): Long? =
  if (has(name) && !isNull(name)) optLong(name) else null
