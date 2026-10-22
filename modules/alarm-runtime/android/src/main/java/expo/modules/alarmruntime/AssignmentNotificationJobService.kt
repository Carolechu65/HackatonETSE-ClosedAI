package expo.modules.alarmruntime

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Read-only background retrieval. Android may defer the minimum 15-minute interval. */
class AssignmentNotificationJobService : JobService() {
  private class Run {
    val stopped = AtomicBoolean(false)
    @Volatile var connection: HttpURLConnection? = null
  }
  @Volatile private var running: Run? = null

  override fun onStartJob(params: JobParameters): Boolean {
    val run = Run()
    running = run
    Thread({
      var retry = false
      try {
        val session = AssignmentNotifications.session(this)
        if (session != null && !run.stopped.get()) {
          val connection = URL(session.baseUrl + "/v1/assignments").openConnection() as HttpURLConnection
          run.connection = connection
          connection.connectTimeout = 15000
          connection.readTimeout = 15000
          connection.instanceFollowRedirects = false
          connection.setRequestProperty("Authorization", "Bearer ${session.token}")
          connection.setRequestProperty("Accept", "application/json")
          when (connection.responseCode) {
            401 -> AssignmentNotifications.expire(this, session.generation)
            200 -> {
              // Bound an untrusted/network response before parsing or creating notifications.
              val body = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                  val count = input.read(buffer)
                  if (count < 0) break
                  check(output.size() + count <= 1024 * 1024) { "Assignment response too large" }
                  output.write(buffer, 0, count)
                }
                output.toString("UTF-8")
              }
              if (!run.stopped.get()) AssignmentNotifications.sync(this, session.userId,
                JSONObject(body).getJSONArray("assignments"), session.generation)
            }
            else -> retry = true
          }
        }
      } catch (_: Exception) {
        retry = true
      } finally {
        run.connection?.disconnect()
        if (!run.stopped.get()) jobFinished(params, retry)
        if (running === run) running = null
      }
    }, "alarmat-assignment-poll").start()
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean {
    running?.let { it.stopped.set(true); it.connection?.disconnect() }
    running = null
    return true
  }
}

internal data class AssignmentSession(val userId: String, val token: String, val baseUrl: String,
  val expiresAt: Long, val generation: String)

/** Shared foreground/background presentation journal. Tokens are encrypted with Android Keystore. */
internal object AssignmentNotifications {
  private const val JOB_ID = 724621
  private const val CHANNEL = "alarmat-proposals-v1"
  private const val KEY_ALIAS = "alarmat_assignment_session_v1"
  private val lock = Any()
  private val identifier = Regex("[A-Za-z0-9_-]{1,128}")
  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("alarmat_assignments_v1", Context.MODE_PRIVATE)

  fun configure(context: Context, input: Map<String, Any?>): Boolean = synchronized(lock) {
    val userId = input["userId"] as? String ?: error("Missing assignment account")
    val token = input["token"] as? String ?: error("Missing assignment session")
    val baseUrl = (input["baseUrl"] as? String)?.trimEnd('/') ?: error("Missing assignment URL")
    val expires = (input["expiresAtEpochMs"] as? Number)?.toLong() ?: error("Missing session expiry")
    val uri = URI(baseUrl)
    require(identifier.matches(userId) && token.length in 1..16384 && !token.contains('\r') && !token.contains('\n'))
    require(uri.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null && uri.query == null && uri.fragment == null)
    if (expires <= System.currentTimeMillis()) { clear(context, userId); return@synchronized false }
    val previous = readSession(context)
    if (previous != null && previous.userId != userId) dismiss(context, previous.userId)
    val unchanged = previous != null && previous.userId == userId && previous.token == token && previous.baseUrl == baseUrl && previous.expiresAt == expires
    val generation = if (unchanged) previous!!.generation else UUID.randomUUID().toString()
    if (!unchanged) {
      val value = JSONObject().put("userId", userId).put("token", token).put("baseUrl", baseUrl)
        .put("expiresAt", expires).put("generation", generation).toString()
      check(prefs(context).edit().putString("session", encrypt(value)).commit()) { "Could not save assignment session" }
    }
    val scheduler = context.getSystemService(JobScheduler::class.java) ?: return@synchronized false
    if (scheduler.getPendingJob(JOB_ID) == null) {
      val job = JobInfo.Builder(JOB_ID, ComponentName(context, AssignmentNotificationJobService::class.java))
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
        .setPeriodic(15 * 60 * 1000L).build()
      return@synchronized scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS
    }
    true
  }

  fun session(context: Context): AssignmentSession? = synchronized(lock) {
    val current = readSession(context) ?: return@synchronized null
    if (current.expiresAt <= System.currentTimeMillis()) { clear(context, current.userId); null } else current
  }

  fun expire(context: Context, generation: String) = synchronized(lock) {
    val current = readSession(context)
    if (current != null && current.generation == generation) clear(context, current.userId)
  }

  fun clear(context: Context, userId: String): Boolean = synchronized(lock) {
    val current = readSession(context)
    dismiss(context, userId)
    if (current?.userId == userId || current == null) {
      check(prefs(context).edit().remove("session").commit())
      context.getSystemService(JobScheduler::class.java)?.cancel(JOB_ID)
    }
    true
  }

  fun sync(context: Context, userId: String, assignments: JSONArray, generation: String? = null): Boolean = synchronized(lock) {
    val current = session(context) ?: return@synchronized false
    if (current.userId != userId || (generation != null && current.generation != generation)) return@synchronized false
    require(assignments.length() <= 1000) { "Too many assignments" }
    val values = (0 until assignments.length()).map { index ->
      assignments.getJSONObject(index).also { value ->
        require(value.getString("id").length in 1..256 && value.getString("kind") in setOf("alarm", "task"))
        require(identifier.matches(value.getString("entityId")) && identifier.matches(value.getString("groupId")))
        require(value.getLong("version") in 1..9007199254740991L)
        require(value.getString("title").length in 1..240 && value.getString("body").length <= 2000)
      }
    }
    val storage = prefs(context)
    val seen = JSONObject(storage.getString("seen_$userId", "{}") ?: "{}")
    val oldActive = JSONArray(storage.getString("active_$userId", "[]") ?: "[]")
    val ids = values.map { it.getString("id") }.toSet()
    val manager = NotificationManagerCompat.from(context)
    for (index in 0 until oldActive.length()) {
      val id = oldActive.getString(index)
      if (id !in ids) manager.cancel(tag(userId, id), 0)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
        NotificationChannel(CHANNEL, "Propuestas de aviso", NotificationManager.IMPORTANCE_DEFAULT))
    }
    val channelEnabled = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
      context.getSystemService(NotificationManager::class.java)?.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    if (manager.areNotificationsEnabled() && channelEnabled) {
      val component = context.packageManager.getLaunchIntentForPackage(context.packageName)?.component
      if (component != null) for (value in values) {
        val id = value.getString("id")
        val version = value.getLong("version")
        if (seen.optLong(id, -1) == version) continue
        val uri = Uri.Builder().scheme("alarmat").authority("assignment")
          .appendPath(value.getString("kind")).appendPath(value.getString("groupId"))
          .appendPath(value.getString("entityId")).build()
        val intent = Intent(Intent.ACTION_VIEW, uri).setComponent(component).setPackage(context.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_alarm_runtime)
          .setContentTitle(value.getString("title")).setContentText(value.getString("body"))
          .setStyle(NotificationCompat.BigTextStyle().bigText(value.getString("body")))
          .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).setOnlyAlertOnce(true)
          .setContentIntent(open).build()
        manager.notify(tag(userId, id), 0, notification)
        seen.put(id, version)
      }
    }
    // Keep bounded history plus active IDs: dismissed notices do not return on each poll.
    val historical = seen.keys().asSequence().toList().filter { it !in ids }
    historical.take((seen.length() - 2000).coerceAtLeast(0)).forEach { seen.remove(it) }
    check(storage.edit().putString("seen_$userId", seen.toString())
      .putString("active_$userId", JSONArray(ids.toList()).toString()).commit())
    true
  }

  private fun tag(userId: String, id: String) = "alarmat-assignment:$userId:$id"

  private fun dismiss(context: Context, userId: String) {
    val storage = prefs(context)
    val active = JSONArray(storage.getString("active_$userId", "[]") ?: "[]")
    val manager = NotificationManagerCompat.from(context)
    for (index in 0 until active.length()) manager.cancel(tag(userId, active.getString(index)), 0)
    check(storage.edit().remove("active_$userId").commit())
  }

  private fun readSession(context: Context): AssignmentSession? {
    val encrypted = prefs(context).getString("session", null) ?: return null
    return try {
      val value = JSONObject(decrypt(encrypted))
      AssignmentSession(value.getString("userId"), value.getString("token"), value.getString("baseUrl"),
        value.getLong("expiresAt"), value.getString("generation"))
    } catch (_: Exception) { null }
  }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    return generator.generateKey()
  }

  private fun encrypt(value: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
      Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
  }

  private fun decrypt(value: String): String {
    val parts = value.split(':', limit = 2)
    require(parts.size == 2)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
    return String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
  }
}
