package expo.modules.alarmruntime

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
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
  private val handler = Handler(Looper.getMainLooper())
  private var mediaPlayer: MediaPlayer? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var activeKey: String? = null

  private val stopRunnable = Runnable { finishAlarm() }

  override fun onCreate() {
    super.onCreate()
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

    startAlarm(key)
    return START_NOT_STICKY
  }

  private fun startAlarm(key: String) {
    if (activeKey == key) return

    val store = AlarmStore(this)
    val occurrence = store.find(key)
    if (occurrence == null ||
      occurrence.status == AlarmOccurrence.STATUS_CANCELLED ||
      occurrence.status == AlarmOccurrence.STATUS_EXPIRED ||
      occurrence.dismissedAtEpochMs != null
    ) {
      stopSelf()
      return
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
    val notificationId = AlarmContract.notificationId(key)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          notificationId,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
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
      AlarmNotifications.notify(this, key, notification)
      stopPlayback()
      stopSelf()
      return
    }

    acquireWakeLock()
    playSound()
    handler.postDelayed(stopRunnable, AlarmContract.MAX_ALARM_DURATION_MS)
  }

  private fun playSound() {
    try {
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        ?: return
      mediaPlayer = MediaPlayer().apply {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        setDataSource(this@AlarmService, uri)
        isLooping = true
        setOnErrorListener { _, _, _ -> true }
        prepare()
        start()
      }
    } catch (_: Exception) {
      runCatching { mediaPlayer?.release() }
      mediaPlayer = null
    }
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
    val key = activeKey
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

  private fun stopPlayback() {
    handler.removeCallbacks(stopRunnable)
    runCatching { mediaPlayer?.stop() }
    runCatching { mediaPlayer?.release() }
    mediaPlayer = null
    wakeLock?.let { lock ->
      if (lock.isHeld) lock.release()
    }
    wakeLock = null
    activeKey = null
  }

  override fun onDestroy() {
    stopPlayback()
    super.onDestroy()
  }
}
