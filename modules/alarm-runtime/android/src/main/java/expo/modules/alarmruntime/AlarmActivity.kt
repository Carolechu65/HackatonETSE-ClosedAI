package expo.modules.alarmruntime

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.text.format.DateFormat
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Date

/**
 * Pantalla de alarma. Se abre desde la notificación o mediante full-screen
 * intent cuando Android lo permite. No depende de React ni de que la app esté
 * viva: los botones llaman directamente a AlarmActions.
 */
class AlarmActivity : Activity() {
  private var occurrenceKey: String? = null

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    recreate()
  }

  @Suppress("DEPRECATION")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    occurrenceKey = intent.getStringExtra(AlarmContract.EXTRA_KEY)
    val occurrence = occurrenceKey?.let { AlarmStore(this).find(it) }
    val title = occurrence?.title?.ifBlank { "Alarma" } ?: "Alarma"
    val time = DateFormat.getTimeFormat(this).format(
      Date(occurrence?.effectiveAtEpochMs ?: System.currentTimeMillis()),
    )

    setContentView(buildContentView(title = title, time = time))
  }

  private fun buildContentView(title: String, time: String): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(dp(24), dp(32), dp(24), dp(32))
      setBackgroundColor(Color.parseColor("#F4F7F4"))
    }

    root.addView(label("ALARMA · alarmaT", 12f, "#36675E", bold = true))
    root.addView(label(title, 34f, "#153C35", bold = true).apply {
      gravity = Gravity.CENTER
      setPadding(0, dp(12), 0, dp(8))
    })
    root.addView(label(time, 22f, "#42534F").apply {
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, dp(28))
    })

    val stop = Button(this).apply {
      text = "Detener"
      textSize = 18f
      setOnClickListener {
        occurrenceKey?.let { AlarmActions.stop(this@AlarmActivity, it) }
        finish()
      }
    }
    root.addView(stop, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      dp(56),
    ))

    val snooze = Button(this).apply {
      text = "Posponer ${AlarmContract.DEFAULT_SNOOZE_MINUTES} min"
      textSize = 16f
      setOnClickListener {
        occurrenceKey?.let {
          AlarmActions.snooze(this@AlarmActivity, it, AlarmContract.DEFAULT_SNOOZE_MINUTES)
        }
        finish()
      }
    }
    root.addView(snooze, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      dp(52),
    ).apply { topMargin = dp(12) })

    root.addView(label(
      "El sonido continúa hasta que pulses Detener o Posponer.",
      13f,
      "#68766E",
    ).apply {
      gravity = Gravity.CENTER
      setPadding(0, dp(24), 0, 0)
    })

    return root
  }

  private fun label(text: String, size: Float, color: String, bold: Boolean = false): TextView =
    TextView(this).apply {
      this.text = text
      textSize = size
      setTextColor(Color.parseColor(color))
      if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
