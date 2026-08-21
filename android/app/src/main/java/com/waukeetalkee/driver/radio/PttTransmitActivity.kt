package com.waukeetalkee.driver.radio

import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.waukeetalkee.driver.R
import kotlinx.coroutines.launch

/**
 * Minimal show-when-locked / turn-screen-on surface while Volume PTT is held.
 * Keeps the process interactive on keyguard so mic capture is less likely to be killed,
 * and gives a simple ON AIR cue without unlocking.
 *
 * Accessibility usually consumes Volume keys; this activity closes when RadioBus
 * reports TX ended, and still handles keys if they reach the window.
 */
class PttTransmitActivity : AppCompatActivity() {

    private var sawTransmitting = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_ptt_transmit)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                RadioBus.state.collect { snap ->
                    if (snap.transmitting) {
                        sawTransmitting = true
                    } else if (sawTransmitting) {
                        finish()
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        sawTransmitting = RadioBus.state.value.transmitting
        setIntent(intent)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> {
                when (event.action) {
                    KeyEvent.ACTION_DOWN -> {
                        if (event.repeatCount == 0) {
                            RadioForegroundService.beginTransmit(this)
                        }
                        return true
                    }
                    KeyEvent.ACTION_UP -> {
                        RadioForegroundService.endTransmit(this)
                        return true
                    }
                }
            }
            KeyEvent.KEYCODE_VOLUME_DOWN -> {
                if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                    RadioForegroundService.cancelTransmit(this)
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }
}
