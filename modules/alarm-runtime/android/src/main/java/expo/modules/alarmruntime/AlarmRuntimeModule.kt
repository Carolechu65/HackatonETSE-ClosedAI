package expo.modules.alarmruntime

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** P4: scaffold only. No permission, scheduling, receiver or sound implementation. */
class AlarmRuntimeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AlarmRuntime")

    AsyncFunction("getCapabilities") {
      mapOf(
        "available" to false,
        "exactAlarms" to false,
        "audibleAlarms" to false,
        "notifications" to false,
        "reason" to "E_NOT_IMPLEMENTED"
      )
    }

    AsyncFunction("getSnapshot") {
      mapOf("available" to false, "revision" to 0, "occurrences" to emptyList<Any>())
    }

    AsyncFunction("schedule") { _: Map<String, Any?>, promise: Promise ->
      promise.reject("E_NOT_IMPLEMENTED", "Android alarm scheduling is not implemented", null)
    }

    AsyncFunction("cancel") { _: Map<String, Any?>, promise: Promise ->
      promise.reject("E_NOT_IMPLEMENTED", "Android alarm cancellation is not implemented", null)
    }
  }
}
