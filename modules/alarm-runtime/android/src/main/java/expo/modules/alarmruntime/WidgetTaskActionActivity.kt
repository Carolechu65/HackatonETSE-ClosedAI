package expo.modules.alarmruntime

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Explicit widget taps enqueue intent only. The authenticated app validates and submits it. */
class WidgetTaskActionActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      // Rotation/recreation must not enqueue the tap again.
      if (savedInstanceState == null) {
        val command = WidgetTaskAction.parse(intent) ?: throw IllegalArgumentException("Invalid widget action")
        WidgetTaskActionStore(this).enqueue(command)
        val component = packageManager.getLaunchIntentForPackage(packageName)?.component
          ?: throw IllegalStateException("Application unavailable")
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("alarmat://assignment/task/${command.groupId}/${command.taskId}"))
          .setComponent(component).setPackage(packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
      }
    } catch (_: Exception) {
      Toast.makeText(this, "No se pudo guardar la acción. Abre AlarmaT y vuelve a intentarlo.", Toast.LENGTH_LONG).show()
    } finally {
      finish()
    }
  }
}

internal data class WidgetTaskAction(
  val id: String,
  val userId: String,
  val groupId: String,
  val taskId: String,
  val expectedVersion: Long,
  val status: String,
  val createdAtEpochMs: Long,
) {
  fun toMap(): Map<String, Any> = mapOf("id" to id, "userId" to userId, "groupId" to groupId,
    "taskId" to taskId, "expectedVersion" to expectedVersion, "status" to status,
    "createdAtEpochMs" to createdAtEpochMs)

  fun sameIntent(other: WidgetTaskAction): Boolean = userId == other.userId && groupId == other.groupId &&
    taskId == other.taskId && expectedVersion == other.expectedVersion && status == other.status

  companion object {
    const val ACTION = "expo.modules.alarmruntime.WIDGET_TASK_ACTION"
    private val identifier = Regex("[A-Za-z0-9_-]{1,128}")
    private const val MAX_SAFE_INTEGER = 9007199254740991L

    fun parse(intent: Intent): WidgetTaskAction? {
      if (intent.action != ACTION) return null
      return validated(UUID.randomUUID().toString(), intent.getStringExtra("userId"),
        intent.getStringExtra("groupId"), intent.getStringExtra("taskId"),
        intent.getLongExtra("expectedVersion", 0), intent.getStringExtra("status"), System.currentTimeMillis())
    }

    fun fromJson(value: JSONObject): WidgetTaskAction? = validated(value.optString("id"),
      value.optString("userId"), value.optString("groupId"), value.optString("taskId"),
      value.optLong("expectedVersion", 0), value.optString("status"), value.optLong("createdAtEpochMs", 0))

    internal fun validated(id: String, userId: String?, groupId: String?, taskId: String?, version: Long,
      status: String?, createdAt: Long): WidgetTaskAction? {
      if (!identifier.matches(id) || userId == null || !identifier.matches(userId) ||
        groupId == null || !identifier.matches(groupId) || taskId == null || !identifier.matches(taskId) ||
        version !in 1..MAX_SAFE_INTEGER || status !in setOf("completed", "pending") || createdAt <= 0) return null
      return WidgetTaskAction(id, userId, groupId, taskId, version, status!!, createdAt)
    }
  }
}

/** Synchronous commits ensure the command survives process death before the app starts. */
internal class WidgetTaskActionStore(context: Context) {
  private val preferences = context.applicationContext.getSharedPreferences("alarmat_widget_task_actions_v1", Context.MODE_PRIVATE)

  fun peek(): List<WidgetTaskAction> = synchronized(lock) { read() }

  fun enqueue(command: WidgetTaskAction) = synchronized(lock) {
    val existing = read()
    if (existing.any { it.sameIntent(command) }) return@synchronized
    check(existing.size < 50) { "Widget command queue full" }
    write(existing + command)
  }

  fun acknowledge(id: String): Boolean = synchronized(lock) { write(read().filterNot { it.id == id }); true }

  fun clearForUser(userId: String): Boolean = synchronized(lock) {
    write(read().filterNot { it.userId == userId }); true
  }

  private fun read(): List<WidgetTaskAction> {
    val array = JSONArray(preferences.getString("commands", "[]") ?: "[]")
    return (0 until array.length()).mapNotNull { index ->
      array.optJSONObject(index)?.let { WidgetTaskAction.fromJson(it) }
    }
  }

  private fun write(commands: List<WidgetTaskAction>) {
    val array = JSONArray()
    commands.forEach { array.put(JSONObject(it.toMap())) }
    check(preferences.edit().putString("commands", array.toString()).commit()) { "Could not persist widget command" }
  }

  companion object { private val lock = Any() }
}
