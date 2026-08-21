package com.waukeetalkee.driver.radio

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.WindowManager
import android.widget.FrameLayout
import com.waukeetalkee.driver.R

/**
 * Optional draw-over-apps HUD when dispatch audio arrives while the driver
 * is in another app. Only shown when SYSTEM_ALERT_WINDOW is granted.
 */
class RadioOverlayHelper(private val context: Context) {
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private var view: FrameLayout? = null

    fun canDrawOverlays(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
    }

    fun showReceiving() {
        showHud(R.layout.overlay_radio_hud)
    }

    fun showTransmitting() {
        showHud(R.layout.overlay_radio_tx)
    }

    private fun showHud(layoutRes: Int) {
        if (!canDrawOverlays()) return
        hide()
        try {
            val overlay = LayoutInflater.from(context)
                .inflate(layoutRes, null) as FrameLayout
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                    or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP
                y = 48
            }
            wm.addView(overlay, params)
            view = overlay
        } catch (_: Exception) {
            view = null
        }
    }

    fun hide() {
        val v = view ?: return
        try {
            wm.removeView(v)
        } catch (_: Exception) {
        }
        view = null
    }
}
