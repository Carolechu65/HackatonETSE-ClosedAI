package expo.modules.alarmruntime

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Puente JS → runtime Android.
 *
 * Contrato (ver src/platform/alarms):
 * - getCapabilities(): permisos/capacidades actuales, nunca supone concesión.
 * - schedule(spec): persiste SCHEDULING, programa con AlarmManager y confirma.
 * - cancel(key): cancela AlarmManager y conserva el registro como CANCELLED.
 * - stop(key) / snooze(key, minutes): acciones explícitas del usuario.
 * - getSnapshot() / reconcile(): estado nativo y recuperación idempotente.
 */
class AlarmRuntimeModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("AlarmRuntime")

    OnCreate {
      context?.let { AlarmNotifications.ensureChannels(it) }
    }

    AsyncFunction("getCapabilities") {
      capabilities()
    }

    AsyncFunction("getSnapshot") {
      val ctx = context
        ?: return@AsyncFunction mapOf(
          "available" to false,
          "revision" to 0,
          "occurrences" to emptyList<Any>(),
        )
      val store = AlarmStore(ctx)
      mapOf(
        "available" to true,
        "revision" to store.revision(),
        "occurrences" to store.snapshot().map { it.snapshotMap() },
      )
    }

    AsyncFunction("reconcile") {
      val ctx = context
        ?: return@AsyncFunction mapOf(
          "rescheduled" to 0,
          "expired" to 0,
          "failed" to 0,
          "reason" to "E_NO_CONTEXT",
        )
      AlarmRecovery.reconcile(ctx).toMap()
    }

    AsyncFunction("schedule") { spec: Map<String, Any?>, promise: Promise ->
      val ctx = context
      if (ctx == null) {
        promise.reject("E_UNAVAILABLE", "Android runtime context is not available", null)
        return@AsyncFunction
      }

      try {
        val occurrence = AlarmOccurrence.fromSpec(spec)
        val store = AlarmStore(ctx)

        // Persistir antes de tocar AlarmManager: si el proceso muere entre
        // ambos pasos, reconcile() puede reparar el estado.
        store.upsert(occurrence.copy(status = AlarmOccurrence.STATUS_SCHEDULING))

        val outcome = AlarmScheduler.schedule(ctx, occurrence)
        when (outcome.status) {
          AlarmScheduler.STATUS_SCHEDULED -> {
            store.update(occurrence.key) { record ->
              record.copy(
                status = AlarmOccurrence.STATUS_SCHEDULED,
                scheduledAtEpochMs = occurrence.effectiveAtEpochMs,
                failureReason = null,
                updatedAtEpochMs = System.currentTimeMillis(),
              )
            }
            promise.resolve(
              mapOf(
                "status" to "SCHEDULED",
                "key" to occurrence.keyMap(),
                "scheduledAtEpochMs" to occurrence.effectiveAtEpochMs,
              ),
            )
          }
          AlarmScheduler.STATUS_PENDING_PERMISSION -> {
            markNotScheduled(ctx, occurrence.key, AlarmOccurrence.STATUS_FAILED, outcome.reason)
            promise.resolve(
              mapOf(
                "status" to "PENDING_PERMISSION",
                "reason" to (outcome.reason ?: "E_PERMISSION"),
              ),
            )
          }
          AlarmScheduler.STATUS_EXPIRED -> {
            markNotScheduled(ctx, occurrence.key, AlarmOccurrence.STATUS_EXPIRED, outcome.reason)
            promise.resolve(
              mapOf(
                "status" to "FAILED",
                "reason" to (outcome.reason ?: "E_EXPIRED"),
              ),
            )
          }
          else -> {
            markNotScheduled(ctx, occurrence.key, AlarmOccurrence.STATUS_FAILED, outcome.reason)
            promise.resolve(
              mapOf(
                "status" to "FAILED",
                "reason" to (outcome.reason ?: "E_SCHEDULE"),
              ),
            )
          }
        }
      } catch (error: Exception) {
        promise.reject(
          "E_INVALID_SPEC",
          error.message ?: "Invalid alarm occurrence",
          error,
        )
      }
    }

    AsyncFunction("cancel") { key: Map<String, Any?>, promise: Promise ->
      val ctx = context
      if (ctx == null) {
        promise.reject("E_UNAVAILABLE", "Android runtime context is not available", null)
        return@AsyncFunction
      }

      try {
        val compositeKey = AlarmContract.keyOf(key)
        val store = AlarmStore(ctx)
        val occurrence = store.find(compositeKey)
        if (occurrence != null) {
          AlarmScheduler.cancel(ctx, occurrence)
          store.update(compositeKey) { record ->
            record.copy(
              status = AlarmOccurrence.STATUS_CANCELLED,
              updatedAtEpochMs = System.currentTimeMillis(),
            )
          }
        }
        AlarmNotifications.cancel(ctx, compositeKey)
        // Cancelar algo ya inexistente es idempotente: el resultado es que no
        // queda una programación activa.
        promise.resolve(mapOf("status" to "CANCELLED", "key" to key))
      } catch (error: Exception) {
        promise.reject("E_CANCEL", error.message ?: "Cancel failed", error)
      }
    }

    AsyncFunction("stop") { key: Map<String, Any?>, promise: Promise ->
      val ctx = context
      if (ctx == null) {
        promise.reject("E_UNAVAILABLE", "Android runtime context is not available", null)
        return@AsyncFunction
      }
      try {
        val stopped = AlarmActions.stop(ctx, AlarmContract.keyOf(key))
        promise.resolve(stopped)
      } catch (error: Exception) {
        promise.reject("E_STOP", error.message ?: "Stop failed", error)
      }
    }

    AsyncFunction("snooze") { key: Map<String, Any?>, minutes: Int, promise: Promise ->
      val ctx = context
      if (ctx == null) {
        promise.reject("E_UNAVAILABLE", "Android runtime context is not available", null)
        return@AsyncFunction
      }
      try {
        val compositeKey = AlarmContract.keyOf(key)
        val outcome = AlarmActions.snooze(ctx, compositeKey, minutes)
        val record = AlarmStore(ctx).find(compositeKey)
        promise.resolve(
          mapOf(
            "status" to outcome.status,
            "reason" to outcome.reason,
            "scheduledAtEpochMs" to record?.effectiveAtEpochMs,
          ),
        )
      } catch (error: Exception) {
        promise.reject("E_SNOOZE", error.message ?: "Snooze failed", error)
      }
    }

    AsyncFunction("requestExactAlarmPermission") { promise: Promise ->
      val ctx = context
      if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        promise.resolve(false)
        return@AsyncFunction
      }
      try {
        val intent = Intent(
          Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
          Uri.parse("package:${ctx.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        promise.resolve(true)
      } catch (_: Exception) {
        promise.resolve(false)
      }
    }

    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      try {
        activity.requestPermissions(
          arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
          NOTIFICATION_PERMISSION_REQUEST_CODE,
        )
        promise.resolve(true)
      } catch (_: Exception) {
        promise.resolve(false)
      }
    }

    AsyncFunction("openNotificationSettings") { promise: Promise ->
      openSettings(
        promise,
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, context?.packageName),
      )
    }

    AsyncFunction("openFullScreenIntentSettings") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        promise.resolve(false)
        return@AsyncFunction
      }
      openSettings(
        promise,
        Intent(
          Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
          Uri.parse("package:${context?.packageName}"),
        ),
      )
    }
  }

  private fun markNotScheduled(context: Context, key: String, status: String, reason: String?) {
    AlarmStore(context).update(key) { record ->
      record.copy(
        status = status,
        failureReason = reason ?: "E_SCHEDULE",
        updatedAtEpochMs = System.currentTimeMillis(),
      )
    }
  }

  private fun openSettings(promise: Promise, intent: Intent) {
    val ctx = context
    if (ctx == null) {
      promise.resolve(false)
      return
    }
    try {
      ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  private fun capabilities(): Map<String, Any?> {
    val ctx = context
      ?: return mapOf(
        "available" to false,
        "exactAlarms" to false,
        "audibleAlarms" to false,
        "notifications" to false,
        "fullScreenIntent" to false,
        "reason" to "E_NO_CONTEXT",
      )

    val alarmManager = ctx.getSystemService(AlarmManager::class.java)
    val notificationManager = ctx.getSystemService(NotificationManager::class.java)

    val exactAlarms = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      true
    } else {
      alarmManager?.canScheduleExactAlarms() == true
    }
    val notifications = notificationManager?.areNotificationsEnabled() == true
    val fullScreenIntent = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      true
    } else {
      notificationManager?.canUseFullScreenIntent() == true
    }
    val reason = when {
      !exactAlarms -> "E_EXACT_ALARM_PERMISSION"
      !notifications -> "E_NOTIFICATION_PERMISSION"
      else -> null
    }

    return mapOf(
      "available" to true,
      "exactAlarms" to exactAlarms,
      "audibleAlarms" to (exactAlarms && notifications),
      "notifications" to notifications,
      "fullScreenIntent" to fullScreenIntent,
      "reason" to reason,
    )
  }

  private companion object {
    const val NOTIFICATION_PERMISSION_REQUEST_CODE = 7401
  }
}
