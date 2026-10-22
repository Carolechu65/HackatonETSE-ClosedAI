package expo.modules.alarmruntime

import android.content.Context
import org.json.JSONObject

/**
 * Store privado del runtime (SharedPreferences).
 *
 * Se escribe antes de llamar a AlarmManager y se conserva aunque el proceso JS
 * muera. No usa expo-sqlite: un BroadcastReceiver no puede depender de abrir la
 * base de la app con React.
 */
class AlarmStore(context: Context) {
  private val prefs = context.applicationContext
    .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun revision(): Long = readRoot().optLong(KEY_REVISION, 0L)

  fun snapshot(): List<AlarmOccurrence> {
    val items = readItems(readRoot())
    return items.values.sortedBy { it.effectiveAtEpochMs }
  }

  fun find(key: String): AlarmOccurrence? = readItems(readRoot())[key]

  fun findByOccurrenceId(occurrenceId: String): AlarmOccurrence? =
    readItems(readRoot()).values.firstOrNull { it.occurrenceId == occurrenceId }

  fun upsert(occurrence: AlarmOccurrence) {
    mutate { items -> items[occurrence.key] = occurrence }
  }

  fun update(key: String, transform: (AlarmOccurrence) -> AlarmOccurrence): AlarmOccurrence? {
    var updated: AlarmOccurrence? = null
    mutate { items ->
      val current = items[key] ?: return@mutate
      val next = transform(current)
      items[next.key] = next
      updated = next
    }
    return updated
  }

  fun remove(key: String) {
    mutate { items -> items.remove(key) }
  }

  private fun readRoot(): JSONObject {
    val raw = prefs.getString(KEY_ROOT, null) ?: return JSONObject()
    return runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
  }

  private fun readItems(root: JSONObject): MutableMap<String, AlarmOccurrence> {
    val result = mutableMapOf<String, AlarmOccurrence>()
    val stored = root.optJSONObject(KEY_ITEMS) ?: return result
    val names = stored.keys()
    while (names.hasNext()) {
      val name = names.next()
      val item = stored.optJSONObject(name) ?: continue
      runCatching { AlarmOccurrence.fromJson(item) }
        .getOrNull()
        ?.let { result[name] = it }
    }
    return result
  }

  private fun mutate(block: (MutableMap<String, AlarmOccurrence>) -> Unit) {
    synchronized(this) {
      val root = readRoot()
      val items = readItems(root)
      block(items)

      val storedItems = JSONObject()
      for ((key, occurrence) in items) {
        storedItems.put(key, occurrence.toJson())
      }
      val nextRoot = JSONObject().apply {
        put(KEY_ITEMS, storedItems)
        put(KEY_REVISION, root.optLong(KEY_REVISION, 0L) + 1L)
      }

      // commit() es intencionado: el registro debe estar en disco antes de
      // devolver SCHEDULED o de lanzar AlarmManager.
      prefs.edit().putString(KEY_ROOT, nextRoot.toString()).commit()
    }
  }

  private companion object {
    const val PREFERENCES_NAME = "expo.modules.alarmruntime.store"
    const val KEY_ROOT = "root"
    const val KEY_ITEMS = "items"
    const val KEY_REVISION = "revision"
  }
}
