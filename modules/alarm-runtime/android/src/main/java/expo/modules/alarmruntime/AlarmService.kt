package expo.modules.alarmruntime

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Foreground service que reproduce el sonido de la alarma.
 *
 * Se inicia desde un BroadcastReceiver de alarma exacta, no desde React. El
 * servicio mantiene una notificación visible con acciones Detener y Posponer.
 */
class AlarmService : Service() {
  companion object {
    private var instance: AlarmService? = null
    /** Cancel only this occurrence, never another alarm currently ringing. */
    fun stopKey(key: String) {
      Handler(Looper.getMainLooper()).post {
        instance?.let { service -> if (service.activeKey == key) service.finishAlarm() }
      }
    }
  }
  private val handler = Handler(Looper.getMainLooper())
  private var mediaPlayer: MediaPlayer? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var audioFocus: AudioFocusRequest? = null
  private val legacyAudioFocus = AudioManager.OnAudioFocusChangeListener { change -> if (change == AudioManager.AUDIOFOCUS_LOSS) finishAlarm() }
  private var activeKey: String? = null

  private val stopRunnable = Runnable { finishAlarm() }

  override fun onCreate() {
    super.onCreate()
    instance = this
    AlarmNotifications.ensureChannels(this)
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val command = intent ?: run {
      stopSelf()
      return START_NOT_STICKY
    }
    val key = command.getStringExtra(AlarmContract.EXTRA_KEY)
    if (key.isNullOrBlank()) {
      stopSelf()
      return START_NOT_STICKY
    }

    when (command.action) {
      AlarmContract.ACTION_STOP -> {
        AlarmActions.stop(this, key)
        return START_NOT_STICKY
      }
      AlarmContract.ACTION_SNOOZE -> {
        AlarmActions.snooze(
          this,
          key,
          command.getIntExtra(
            AlarmContract.EXTRA_SNOOZE_MINUTES,
            AlarmContract.DEFAULT_SNOOZE_MINUTES,
          ),
        )
        return START_NOT_STICKY
      }
    }

    synchronized(AlarmStore.lock) { startAlarm(key) }
    return START_NOT_STICKY
  }

  private fun startAlarm(key: String) {
    if (activeKey == key) return

    val store = AlarmStore(this)
    val occurrence = store.find(key)
    if (occurrence == null ||
      occurrence.status != AlarmOccurrence.STATUS_FIRED ||
      occurrence.dismissedAtEpochMs != null ||
      !AlarmScheduler.notificationsEnabled(this) || !AlarmScheduler.canScheduleExactAlarms(this)
    ) {
      if (activeKey == null) stopSelf()
      return
    }

    // One audible presentation at a time. A concurrent alarm explicitly supersedes
    // the previous sound, whose consumed/dismissed state remains in the snapshot.
    activeKey?.let { previous ->
      val previousOccurrence = store.find(previous)
      if (previousOccurrence != null && AlarmPolicy.shouldRepeatTask(previousOccurrence.taskId, previousOccurrence.mode,
          previousOccurrence.status, previousOccurrence.dismissedAtEpochMs != null)) {
        AlarmActions.snooze(this, previous, AlarmPolicy.TASK_REPEAT_MINUTES,
          AlarmPolicy.nextTaskReminderAt(previousOccurrence.firedAtEpochMs, System.currentTimeMillis()))
      } else store.update(previous) { it.copy(dismissedAtEpochMs = System.currentTimeMillis()) }
    }
    stopPlayback()

    val now = System.currentTimeMillis()
    activeKey = key
    store.update(key) { record ->
      record.copy(
        status = AlarmOccurrence.STATUS_FIRED,
        firedAtEpochMs = now,
        updatedAtEpochMs = now,
      )
    }

    val notification = AlarmNotifications.buildAlarmNotification(this, occurrence)
    val notificationId = 7100
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(
          notificationId,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED,
        )
      } else {
        startForeground(notificationId, notification)
      }
    } catch (error: Exception) {
      store.update(key) { record ->
        record.copy(
          status = AlarmOccurrence.STATUS_FAILED,
          failureReason = "E_FOREGROUND:${error.message ?: error.javaClass.simpleName}",
          updatedAtEpochMs = System.currentTimeMillis(),
        )
      }
      stopPlayback()
      stopSelf()
      return
    }

    acquireWakeLock()
    if (!runCatching { acquireAudioFocus() }.getOrDefault(false)) {
      store.update(key) { it.copy(status = AlarmOccurrence.STATUS_FAILED, failureReason = "E_AUDIO_FOCUS") }
      finishAlarm()
      return
    }
    if (!playSound()) {
      store.update(key) { it.copy(status = AlarmOccurrence.STATUS_FAILED, failureReason = "E_AUDIO_PLAYBACK") }
      finishAlarm()
      return
    }
    handler.postDelayed(stopRunnable, if (occurrence.taskId != null) AlarmPolicy.TASK_RING_DURATION_MS else AlarmContract.MAX_ALARM_DURATION_MS)
  }

  private fun playSound(): Boolean {
    try {
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        ?: return false
      mediaPlayer = MediaPlayer()
      mediaPlayer!!.apply {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        setDataSource(this@AlarmService, uri)
        isLooping = true
        setOnErrorListener { _, _, _ ->
          activeKey?.let { key -> AlarmStore(this@AlarmService).update(key) { if (it.status == AlarmOccurrence.STATUS_FIRED) it.copy(status = AlarmOccurrence.STATUS_FAILED, failureReason = "E_AUDIO_PLAYBACK") else it } }
          finishAlarm()
          true
        }
        prepare()
        start()
      }
      return true
    } catch (_: Exception) {
      runCatching { mediaPlayer?.release() }
      mediaPlayer = null
      return false
    }
  }

  private fun acquireAudioFocus(): Boolean {
    if (Build.VERSION.SDK_INT < 26) {
      @Suppress("DEPRECATION")
      return getSystemService(AudioManager::class.java).requestAudioFocus(legacyAudioFocus, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
      .setOnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS) finishAlarm()
      }.build()
    audioFocus = request
    return getSystemService(AudioManager::class.java).requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }

  private fun acquireWakeLock() {
    try {
      val powerManager = getSystemService(PowerManager::class.java)
      wakeLock = powerManager.newWakeLock(
        PowerManager.PARTIAL_WAKE_LOCK,
        "alarmT:alarm-runtime",
      ).apply {
        setReferenceCounted(false)
        acquire(AlarmContract.MAX_ALARM_DURATION_MS + 30_000L)
      }
    } catch (_: Exception) {
      wakeLock = null
    }
  }

  /** Tope de seguridad si nadie pulsa Detener. */
  private fun finishAlarm() {
    synchronized(AlarmStore.lock) {
    val key = activeKey
    // A stopped/elapsed task alarm keeps the same accepted occurrence. A real
    // cancellation persists CANCELLED first, so it can never enter this branch.
    key?.let { currentKey ->
      AlarmStore(this).find(currentKey)?.let { occurrence ->
        if (AlarmPolicy.shouldRepeatTask(occurrence.taskId, occurrence.mode, occurrence.status, occurrence.dismissedAtEpochMs != null))
          AlarmActions.snooze(this, currentKey, AlarmPolicy.TASK_REPEAT_MINUTES,
            AlarmPolicy.nextTaskReminderAt(occurrence.firedAtEpochMs, System.currentTimeMillis()))
      }
    }
    stopPlayback()

    if (key != null) {
      val now = System.currentTimeMillis()
      AlarmStore(this).update(key) { record ->
        if (record.status == AlarmOccurrence.STATUS_FIRED) {
          record.copy(
            dismissedAtEpochMs = record.dismissedAtEpochMs ?: now,
            updatedAtEpochMs = now,
          )
        } else {
          record
        }
      }
      AlarmNotifications.cancel(this, key)
    }

    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    }
  }

  private fun stopPlayback() {
    handler.removeCallbacks(stopRunnable)
    runCatching { mediaPlayer?.stop() }
    runCatching { mediaPlayer?.release() }
    mediaPlayer = null
    if (Build.VERSION.SDK_INT >= 26) audioFocus?.let { getSystemService(AudioManager::class.java).abandonAudioFocusRequest(it) }
    else {
      @Suppress("DEPRECATION")
      getSystemService(AudioManager::class.java).abandonAudioFocus(legacyAudioFocus)
    }
    audioFocus = null
    wakeLock?.let { lock ->
      if (lock.isHeld) lock.release()
    }
    wakeLock = null
    activeKey = null
  }

  override fun onDestroy() {
    stopPlayback()
    if (instance === this) instance = null
    super.onDestroy()
  }
}
